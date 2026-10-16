from PIL import Image
import numpy as np

img = Image.open(r'C:\Users\User1\.gemini\antigravity\brain\46acb076-7060-430a-afa7-88c40f485ae5\ref_shuf_btn_alone.png').convert('RGB')
arr = np.array(img)

pixels = []
for y in range(arr.shape[0]):
    for x in range(arr.shape[1]):
        if tuple(arr[y, x]) == (47, 55, 77):
            pixels.append((x, y))

min_x = min(x for x, y in pixels)
min_y = min(y for x, y in pixels)
max_x = max(x for x, y in pixels)
max_y = max(y for x, y in pixels)

w = max_x - min_x + 1
h = max_y - min_y + 1
print(f'Text bounding box: x={min_x}..{max_x} (w={w}), y={min_y}..{max_y} (h={h})')

rects = []
for x, y in pixels:
    rects.append(f'M{x - min_x},{y - min_y}h1v1h-1z')

path_d = ''.join(rects)
svg = f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {w} {h}' shape-rendering='crispEdges'><path d='{path_d}' fill='rgb(47,55,77)'/></svg>"
print('SVG dimensions:', w, h)
print('SVG:', svg)

import urllib.parse
data_uri = 'data:image/svg+xml,' + urllib.parse.quote(svg)
print('Data URI:', data_uri)
with open('scripts/shuf_data_uri.txt', 'w') as f:
    f.write(data_uri)
