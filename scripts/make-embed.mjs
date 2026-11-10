import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://cromservices.github.io/subzero-refrigeration-preview/";

function abs(cssOrHtml) {
  return cssOrHtml
    .replaceAll("../assets/", BASE + "assets/")
    .replace(/(href|src|srcset)=["']assets\//g, '$1="' + BASE + "assets/")
    .replace(/url\((['"]?)assets\//g, "url($1" + BASE + "assets/")
    .replaceAll('href="css/site.css"', "")
    .replaceAll('src="js/site.js"', "");
}

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "css/site.css"), "utf8");
const js = fs.readFileSync(path.join(root, "js/site.js"), "utf8");

const cssAbs = abs(css);
let out = html.replace(
  '<link rel="stylesheet" href="css/site.css">',
  "<style>\n" + cssAbs + "\n</style>"
);
out = out.replace('<script src="js/site.js"></script>', "<script>\n" + js + "\n</script>");
out = abs(out);
out = out.replaceAll(BASE + BASE, BASE);

fs.writeFileSync(path.join(root, "wix-embed.html"), out);
console.log("wrote wix-embed.html", out.length);
