"""Cut a bounding box out of a remote PMTiles v3 archive using HTTP range requests.

Stdlib only. Usage:
  python -I pmtiles_extract.py <url> <out.pmtiles> <min_lon> <min_lat> <max_lon> <max_lat> [max_zoom]

Only the directories and tiles that cover the box are downloaded, so a city out
of the ~140 GB Protomaps planet costs tens of MB.
"""
import gzip, io, json, math, struct, sys, urllib.request

UA = {'User-Agent': 'pmtiles-extract/1.0'}


def fetch(url, off, length):
    req = urllib.request.Request(url, headers={**UA, 'Range': f'bytes={off}-{off + length - 1}'})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    if len(data) != length:
        raise IOError(f'short read {len(data)} != {length} at {off}')
    return data


def uvarint(b, i):
    r = s = 0
    while True:
        c = b[i]; i += 1
        r |= (c & 0x7F) << s
        if c < 0x80:
            return r, i
        s += 7


def put_uvarint(out, v):
    while v >= 0x80:
        out.append((v & 0x7F) | 0x80); v >>= 7
    out.append(v)


def decompress(data, kind):
    if kind in (0, 1):
        return data
    if kind == 2:
        return gzip.decompress(data)
    raise ValueError(f'unsupported compression {kind}')


def read_dir(raw):
    n, i = uvarint(raw, 0)
    ids, runs, lens, offs = [0] * n, [0] * n, [0] * n, [0] * n
    last = 0
    for k in range(n):
        d, i = uvarint(raw, i); last += d; ids[k] = last
    for k in range(n):
        runs[k], i = uvarint(raw, i)
    for k in range(n):
        lens[k], i = uvarint(raw, i)
    for k in range(n):
        v, i = uvarint(raw, i)
        offs[k] = offs[k - 1] + lens[k - 1] if (v == 0 and k > 0) else v - 1
    return list(zip(ids, runs, lens, offs))


def write_dir(entries):
    out = bytearray()
    put_uvarint(out, len(entries))
    last = 0
    for e in entries:
        put_uvarint(out, e[0] - last); last = e[0]
    for e in entries: put_uvarint(out, e[1])
    for e in entries: put_uvarint(out, e[2])
    for k, e in enumerate(entries):
        if k > 0 and e[3] == entries[k - 1][3] + entries[k - 1][2]:
            put_uvarint(out, 0)
        else:
            put_uvarint(out, e[3] + 1)
    return gzip.compress(bytes(out), mtime=0)


def zxy_to_id(z, x, y):
    acc = ((1 << (2 * z)) - 1) // 3
    n = 1 << z
    d, s = 0, n >> 1
    while s > 0:
        rx = 1 if x & s else 0
        ry = 1 if y & s else 0
        d += s * s * ((3 * rx) ^ ry)
        if ry == 0:
            if rx == 1:
                x, y = n - 1 - x, n - 1 - y
            x, y = y, x
        s >>= 1
    return acc + d


assert [zxy_to_id(1, 0, 0), zxy_to_id(1, 0, 1), zxy_to_id(1, 1, 1), zxy_to_id(1, 1, 0)] == [1, 2, 3, 4]


def lonlat_to_tile(lon, lat, z):
    n = 1 << z
    x = int((lon + 180) / 360 * n)
    r = math.radians(lat)
    y = int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n)
    return min(max(x, 0), n - 1), min(max(y, 0), n - 1)


def main():
    url, out_path = sys.argv[1], sys.argv[2]
    min_lon, min_lat, max_lon, max_lat = map(float, sys.argv[3:7])
    hdr = fetch(url, 0, 127)
    assert hdr[:7] == b'PMTiles' and hdr[7] == 3, 'not a PMTiles v3 archive'
    (root_off, root_len, meta_off, meta_len, leaf_off, leaf_len, data_off, data_len,
     _addr, _entries, _contents) = struct.unpack_from('<11Q', hdr, 8)
    internal, tile_comp, tile_type, src_min_z, src_max_z = hdr[97], hdr[98], hdr[99], hdr[100], hdr[101]
    max_z = min(int(sys.argv[7]) if len(sys.argv) > 7 else src_max_z, src_max_z)
    print(f'source zoom {src_min_z}-{src_max_z}, extracting 0-{max_z}', flush=True)

    root = read_dir(decompress(fetch(url, root_off, root_len), internal))
    leaf_cache = {}

    def find(tid):
        entries = root
        for _ in range(4):
            lo, hi = 0, len(entries) - 1
            hit = None
            while lo <= hi:
                m = (lo + hi) // 2
                if entries[m][0] <= tid:
                    hit = entries[m]; lo = m + 1
                else:
                    hi = m - 1
            if hit is None:
                return None
            eid, run, ln, off = hit
            if run == 0:
                key = (off, ln)
                if key not in leaf_cache:
                    leaf_cache[key] = read_dir(decompress(fetch(url, leaf_off + off, ln), internal))
                entries = leaf_cache[key]
                continue
            return (off, ln) if tid < eid + run else None
        return None

    wanted = []
    for z in range(0, max_z + 1):
        x0, y0 = lonlat_to_tile(min_lon, max_lat, z)
        x1, y1 = lonlat_to_tile(max_lon, min_lat, z)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                wanted.append(zxy_to_id(z, x, y))
    wanted.sort()
    print(f'{len(wanted)} tiles in box', flush=True)

    located = []
    for k, tid in enumerate(wanted):
        loc = find(tid)
        if loc:
            located.append((tid, loc[0], loc[1]))
        if k % 1000 == 999:
            print(f'  indexed {k + 1}/{len(wanted)} ({len(leaf_cache)} leaf dirs)', flush=True)
    print(f'{len(located)} tiles present, {len(leaf_cache)} leaf directories read', flush=True)

    # Fetch tile bytes in merged ranges: neighbouring tiles sit close together.
    by_off = sorted({(o, l) for _, o, l in located})
    blobs, runs = {}, []
    for o, l in by_off:
        if runs and o - (runs[-1][1]) <= 256 * 1024 and runs[-1][1] - runs[-1][0] < 32 << 20:
            runs[-1][1] = max(runs[-1][1], o + l); runs[-1][2].append((o, l))
        else:
            runs.append([o, o + l, [(o, l)]])
    total = sum(r[1] - r[0] for r in runs)
    print(f'downloading {len(runs)} ranges, {total / 1e6:.1f} MB', flush=True)
    for k, (a, b, members) in enumerate(runs):
        chunk = fetch(url, data_off + a, b - a)
        for o, l in members:
            blobs[(o, l)] = chunk[o - a:o - a + l]
        if k % 20 == 19:
            print(f'  ranges {k + 1}/{len(runs)}', flush=True)

    # Write: dedupe identical tiles (ocean/empty tiles repeat), RLE consecutive repeats.
    data, offsets, entries = io.BytesIO(), {}, []
    for tid, o, l in located:
        blob = blobs[(o, l)]
        if blob not in offsets:
            offsets[blob] = data.tell(); data.write(blob)
        off = offsets[blob]
        if entries and entries[-1][3] == off and entries[-1][0] + entries[-1][1] == tid:
            entries[-1][1] += 1
        else:
            entries.append([tid, 1, len(blob), off])
    tile_bytes = data.getvalue()

    root_b, leaves_b = write_dir(entries), b''
    if len(root_b) > 16384 - 127:
        leaf_size = 4096
        while True:
            leaves, root_entries = bytearray(), []
            for i in range(0, len(entries), leaf_size):
                chunk = write_dir(entries[i:i + leaf_size])
                root_entries.append([entries[i][0], 0, len(chunk), len(leaves)])
                leaves += chunk
            root_b = write_dir(root_entries)
            if len(root_b) <= 16384 - 127:
                leaves_b = bytes(leaves); break
            leaf_size *= 2

    meta = decompress(fetch(url, meta_off, meta_len), internal) if meta_len else b'{}'
    try:
        m = json.loads(meta); m['extract'] = {'bbox': [min_lon, min_lat, max_lon, max_lat], 'source': url}
        meta = json.dumps(m, ensure_ascii=False).encode()
    except ValueError:
        pass
    meta_b = gzip.compress(meta, mtime=0)

    o_root = 127
    o_meta = o_root + len(root_b)
    o_leaf = o_meta + len(meta_b)
    o_data = o_leaf + len(leaves_b)
    addressed = sum(e[1] for e in entries)
    head = bytearray(b'PMTiles' + bytes([3]))
    head += struct.pack('<11Q', o_root, len(root_b), o_meta, len(meta_b), o_leaf, len(leaves_b),
                        o_data, len(tile_bytes), addressed, len(entries), len(offsets))
    cz = max_z - 3
    head += bytes([1, 2, tile_comp, tile_type, 0, max_z])
    head += struct.pack('<iiii', round(min_lon * 1e7), round(min_lat * 1e7), round(max_lon * 1e7), round(max_lat * 1e7))
    head += bytes([cz]) + struct.pack('<ii', round((min_lon + max_lon) / 2 * 1e7), round((min_lat + max_lat) / 2 * 1e7))
    assert len(head) == 127
    with open(out_path, 'wb') as f:
        f.write(head); f.write(root_b); f.write(meta_b); f.write(leaves_b); f.write(tile_bytes)
    print(f'wrote {out_path}: {o_data + len(tile_bytes) / 1:,.0f} bytes, {addressed} tiles, {len(offsets)} unique', flush=True)


if __name__ == '__main__':
    main()
