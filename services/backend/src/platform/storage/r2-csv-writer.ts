const PART_BYTES = 5 * 1024 * 1024;

/** Writes UTF-8 CSV incrementally while retaining at most one R2 part in memory. */
export class R2CsvWriter {
	private readonly encoder = new TextEncoder();
	private buffer = new Uint8Array(PART_BYTES);
	private bufferedBytes = 0;
	private multipart: R2MultipartUpload | null = null;
	private parts: R2UploadedPart[] = [];
	private totalBytes = 0;

	constructor(
		private readonly bucket: R2Bucket,
		private readonly key: string,
		private readonly metadata: R2PutOptions,
	) {}

	get byteLength(): number {
		return this.totalBytes;
	}

	async write(text: string): Promise<void> {
		const bytes = this.encoder.encode(text);
		this.totalBytes += bytes.byteLength;
		let sourceOffset = 0;
		while (sourceOffset < bytes.byteLength) {
			const available = PART_BYTES - this.bufferedBytes;
			const length = Math.min(available, bytes.byteLength - sourceOffset);
			this.buffer.set(bytes.subarray(sourceOffset, sourceOffset + length), this.bufferedBytes);
			this.bufferedBytes += length;
			sourceOffset += length;
			if (this.bufferedBytes === PART_BYTES) await this.flushFullPart();
		}
	}

	async complete(): Promise<void> {
		if (!this.multipart) {
			await this.bucket.put(this.key, this.buffer.slice(0, this.bufferedBytes), this.metadata);
			this.bufferedBytes = 0;
			return;
		}
		if (this.bufferedBytes > 0) {
			this.parts.push(await this.multipart.uploadPart(this.parts.length + 1, this.buffer.slice(0, this.bufferedBytes)));
			this.bufferedBytes = 0;
		}
		await this.multipart.complete(this.parts);
		this.multipart = null;
	}

	async abort(): Promise<void> {
		if (!this.multipart) return;
		await this.multipart.abort().catch(() => undefined);
		this.multipart = null;
	}

	private async flushFullPart(): Promise<void> {
		this.multipart ??= await this.bucket.createMultipartUpload(this.key, this.metadata);
		this.parts.push(await this.multipart.uploadPart(this.parts.length + 1, this.buffer));
		this.buffer = new Uint8Array(PART_BYTES);
		this.bufferedBytes = 0;
	}
}
