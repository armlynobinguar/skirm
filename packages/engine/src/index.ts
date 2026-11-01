// @skirm/engine: deterministic v2 match engine for skirm (two crews, one shared map), plus the
// canonical JSON and SHA-256 every hashed object uses. '@skirm/engine/v2' imports the same v2 API.
export * from './v2';
export { canonicalJson, canonicalHash, sha256Hex } from './canonical';
