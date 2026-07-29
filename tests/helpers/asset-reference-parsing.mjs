import assert from "node:assert/strict";

export function attributeValue(tag, attributeName) {
  return tag.match(new RegExp(`\\b${attributeName}="([^"]*)"`))?.[1];
}

export function parseSrcsetEntries(srcset) {
  return srcset.split(",").map((entry) => {
    const match = entry.trim().match(/^(\S+)\s+(\d+)w$/);
    assert.ok(match, `srcset entry must use a width descriptor: ${entry}`);
    return { source: match[1], width: Number(match[2]) };
  });
}
