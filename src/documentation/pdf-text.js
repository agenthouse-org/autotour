import zlib from "node:zlib";

export function pdfPageTexts(buffer) {
  const raw = Buffer.from(buffer).toString("latin1");
  const objects = new Map();
  for (const match of raw.matchAll(/(\d+)\s+0\s+obj\b([\s\S]*?)\bendobj\b/g)) objects.set(match[1], match[2]);
  const codes = characterMap(objects);
  return pagesRoot(objects).map(id => pageText(objects, codes, id));
}

export function pageForText(pages, text, title = "") {
  let found = 0;
  pages.forEach((page, index) => {
    const body = title ? page.replaceAll(title, "") : page;
    if (body.includes(text)) found = index + 1;
  });
  return found;
}

function pagesRoot(objects) {
  for (const body of objects.values()) {
    if (!/\/Type\s*\/Pages\b/.test(body)) continue;
    const kids = body.match(/\/Kids\s*\[([^\]]*)\]/);
    if (!kids) continue;
    return [...kids[1].matchAll(/(\d+)\s+0\s+R/g)].map(match => match[1]);
  }
  return [];
}

function pageText(objects, codes, id) {
  const body = objects.get(id) ?? "";
  const array = body.match(/\/Contents\s*\[([^\]]*)\]/);
  const single = body.match(/\/Contents\s+(\d+)\s+0\s+R/);
  const refs = array ? [...array[1].matchAll(/(\d+)\s+0\s+R/g)].map(match => match[1]) : (single ? [single[1]] : []);
  return refs.map(ref => decodeContent(streamText(objects.get(ref) ?? ""), codes)).join("");
}

function characterMap(objects) {
  const map = new Map();
  for (const body of objects.values()) {
    const text = streamText(body);
    if (!text.includes("beginbfchar") && !text.includes("beginbfrange")) continue;
    for (const block of text.matchAll(/\d+\s+beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const line of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) setCode(map, line[1], hexToText(line[2]));
    }
    for (const block of text.matchAll(/\d+\s+beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const line of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        let code = Number.parseInt(line[1], 16);
        const end = Number.parseInt(line[2], 16);
        let unicode = Number.parseInt(line[3], 16);
        for (; code <= end; code += 1, unicode += 1) setCode(map, code.toString(16), String.fromCodePoint(unicode));
      }
    }
  }
  return map;
}

function setCode(map, code, text) {
  map.set(Number.parseInt(code, 16), text);
}

function decodeContent(value, codes) {
  let skipHex = false;
  let text = "";
  const pattern = /\/ActualText\s*\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]+)>/g;
  for (const match of value.matchAll(pattern)) {
    if (match[1] !== undefined) {
      text += decodeLiteral(match[1]).replaceAll("\uFB01", "fi");
      skipHex = true;
      continue;
    }
    if (skipHex) {
      skipHex = false;
      continue;
    }
    text += decodeHex(match[2], codes);
  }
  return text.replaceAll("\uFB01", "fi");
}

function decodeHex(value, codes) {
  const hex = value.replace(/\s+/g, "");
  let text = "";
  for (let index = 0; index < hex.length; index += 4) {
    const code = Number.parseInt(hex.slice(index, index + 4), 16);
    text += codes.get(code) ?? "";
  }
  return text;
}

function streamText(body) {
  const marker = body.match(/stream\r?\n/);
  if (!marker) return "";
  const start = marker.index + marker[0].length;
  const end = body.indexOf("endstream", start);
  if (end < 0) return "";
  const bytes = Buffer.from(body.slice(start, end), "latin1");
  if (!/\/FlateDecode\b/.test(body)) return bytes.toString("latin1");
  try { return zlib.inflateSync(bytes).toString("latin1"); }
  catch { try { return zlib.inflateSync(bytes.subarray(0, bytes.length - 1)).toString("latin1"); } catch { return ""; } }
}

function decodeLiteral(value) {
  return value.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (whole, code) => {
    if (code === "n") return "\n";
    if (code === "r") return "\r";
    if (code === "t") return "\t";
    if (code === "b") return "\b";
    if (code === "f") return "\f";
    if (code === "(" || code === ")" || code === "\\") return code;
    return String.fromCharCode(Number.parseInt(code, 8));
  });
}

function hexToText(value) {
  const bytes = Buffer.from(value.length % 2 ? `${value}0` : value, "hex");
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return Buffer.from(bytes.subarray(2)).swap16().toString("utf16le");
  if (bytes.length === 2) return String.fromCharCode((bytes[0] << 8) | bytes[1]);
  return bytes.toString("latin1");
}
