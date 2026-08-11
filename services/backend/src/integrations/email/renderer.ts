// ============================================================
// Tiny, dependency-free email template renderer.
//
// Supports `{{variable}}` substitution with:
//   - HTML escaping (safe by default in `html` output)
//   - default values:  {{name|there}}
//   - missing-variable detection (reported, not silently blank)
//
// Conditionals / loops are intentionally NOT supported yet; the
// `{{var}}` surface is stable so we can grow into a fuller syntax
// later without breaking stored templates.
// ============================================================

import { esc } from "../../platform/http/shared";

/** Match {{ key }} or {{ key|default text }}. */
const TOKEN = /\{\{\s*([\w.]+)\s*(?:\|([^}]*))?\}\}/g;

export interface RenderResult {
	output: string;
	/** Variable names referenced by the template but absent from `data`. */
	missing: string[];
}

export type TemplateData = Record<string, unknown>;

/**
 * Render a template string against `data`.
 * @param escapeHtml when true (default for HTML bodies) values are HTML-escaped.
 *                   Pass false for plain-text bodies and subjects.
 */
export function render(
	template: string,
	data: TemplateData,
	escapeHtml = true,
): RenderResult {
	const missing = new Set<string>();

	const output = String(template ?? "").replace(TOKEN, (_m, rawKey: string, dflt?: string) => {
		const key = rawKey.trim();
		const has = data[key] !== undefined && data[key] !== null && data[key] !== "";
		let value: string;
		if (has) {
			value = String(data[key]);
		} else if (dflt !== undefined) {
			value = dflt;
		} else {
			missing.add(key);
			value = "";
		}
		return escapeHtml ? esc(value) : value;
	});

	return { output, missing: [...missing] };
}

/** Render subject + html + text together, collecting all missing vars once. */
export function renderTemplate(
	tpl: { subject: string; html: string; text: string },
	data: TemplateData,
): { subject: string; html: string; text: string; missing: string[] } {
	const subject = render(tpl.subject, data, false);
	const html = render(tpl.html, data, true);
	const text = render(tpl.text, data, false);
	const missing = [...new Set([...subject.missing, ...html.missing, ...text.missing])];
	return { subject: subject.output, html: html.output, text: text.output, missing };
}

/** List the distinct variable names a template references (for the admin UI hint). */
export function templateVariables(...templates: string[]): string[] {
	const found = new Set<string>();
	for (const tpl of templates) {
		for (const m of String(tpl ?? "").matchAll(TOKEN)) {
			found.add(m[1].trim());
		}
	}
	return [...found];
}
