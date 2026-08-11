import * as fontkit from "fontkit";
import { resolve } from "node:path";

for (const file of [
	"cairo-arabic-variable.woff2",
	"tajawal-arabic-400.woff2",
	"noto-sans-arabic-variable.woff2",
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
