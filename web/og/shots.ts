// The list of live-site screenshots in config/app.json web.shots, checked before any browser starts.

export interface ShotSpec {
  path: string;
  ready: string;
  out: string;
  device?: string;
  width?: number;
  height?: number;
}

/** Checks each entry of web.shots.list and returns it typed; throws with the entry index on the first problem. */
export function shotList(list: unknown, knownDevices: readonly string[]): ShotSpec[] {
  if (!Array.isArray(list) || list.length === 0) throw new Error("web.shots.list: expected a non-empty array");
  const outs = new Set<string>();
  return list.map((raw, i) => {
    const at = `web.shots.list[${i}]`;
    if (typeof raw !== "object" || raw === null) throw new Error(`${at}: expected an object`);
    const e = raw as Record<string, unknown>;
    for (const k of ["path", "ready", "out"] as const) {
      if (typeof e[k] !== "string" || e[k] === "") throw new Error(`${at}.${k}: expected a non-empty string`);
    }
    const spec = e as unknown as ShotSpec;
    if (!spec.path.startsWith("/")) throw new Error(`${at}.path: must start with /`);
    if (!spec.out.endsWith(".png") || spec.out.startsWith("/") || spec.out.includes("..")) {
      throw new Error(`${at}.out: expected a .png path inside the repository`);
    }
    if (outs.has(spec.out)) throw new Error(`${at}.out: ${spec.out} is listed twice`);
    outs.add(spec.out);
    if (spec.device !== undefined) {
      if (!knownDevices.includes(spec.device)) throw new Error(`${at}.device: unknown device ${spec.device}`);
    } else if (!(Number.isInteger(spec.width) && Number.isInteger(spec.height) && spec.width! > 0 && spec.height! > 0)) {
      throw new Error(`${at}: give a device, or a positive whole width and height`);
    }
    return spec;
  });
}
