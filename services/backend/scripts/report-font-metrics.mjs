import * as fontkit from "fontkit";
import { resolve } from "node:path";

// D-07: Cairo is the only approved family, so only the Cairo files are measured.
for (const file of [
	"cairo-arabic-variable.woff2",
	"cairo-latin-core-variable.woff2",
	"cairo-latin-variable.woff2",
]) {
	const font = fontkit.openSync(resolve("assets", "static", "fonts", file));
	console.log(file, {
		unitsPerEm: font.unitsPerEm,
		ascent: font.ascent,
		descent: font.descent,
		lineGap: font.lineGap,
		xHeight: font.xHeight,
		capHeight: font.capHeight,
	});
}
