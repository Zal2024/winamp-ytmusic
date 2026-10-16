import xml.etree.ElementTree as ET
import urllib.parse

def make_left_triangle(x_tip):
    xb = x_tip + 5
    rects = []
    # y=0: upper back bevel (dark)
    rects.append(f"<rect x='{xb-1}' y='0' width='2' height='1' fill='%234a5a6b'/>")
    # y=1
    rects.append(f"<rect x='{xb-2}' y='1' width='1' height='1' fill='%234a5a6b'/>")
    rects.append(f"<rect x='{xb-1}' y='1' width='1' height='1' fill='%2397a8b9'/>")
    rects.append(f"<rect x='{xb}' y='1' width='1' height='1' fill='%23efffff'/>")
    # y=2
    rects.append(f"<rect x='{xb-3}' y='2' width='1' height='1' fill='%234a5a6b'/>")
    rects.append(f"<rect x='{xb-2}' y='2' width='2' height='1' fill='%2397a8b9'/>")
    rects.append(f"<rect x='{xb}' y='2' width='1' height='1' fill='%23efffff'/>")
    # y=3
    rects.append(f"<rect x='{xb-4}' y='3' width='1' height='1' fill='%234a5a6b'/>")
    rects.append(f"<rect x='{xb-3}' y='3' width='3' height='1' fill='%2397a8b9'/>")
    rects.append(f"<rect x='{xb}' y='3' width='1' height='1' fill='%23efffff'/>")
    # y=4: tip
    rects.append(f"<rect x='{x_tip}' y='4' width='1' height='1' fill='%234a5a6b'/>")
    rects.append(f"<rect x='{x_tip+1}' y='4' width='4' height='1' fill='%2397a8b9'/>")
    rects.append(f"<rect x='{xb}' y='4' width='1' height='1' fill='%23efffff'/>")
    # y=5: tip bottom
    rects.append(f"<rect x='{x_tip}' y='5' width='1' height='1' fill='%23efffff'/>")
    rects.append(f"<rect x='{x_tip+1}' y='5' width='4' height='1' fill='%2397a8b9'/>")
    rects.append(f"<rect x='{xb}' y='5' width='1' height='1' fill='%23efffff'/>")
    # y=6
    rects.append(f"<rect x='{x_tip+1}' y='6' width='1' height='1' fill='%23efffff'/>")
    rects.append(f"<rect x='{x_tip+2}' y='6' width='3' height='1' fill='%2397a8b9'/>")
    rects.append(f"<rect x='{xb}' y='6' width='1' height='1' fill='%23efffff'/>")
    # y=7
    rects.append(f"<rect x='{x_tip+2}' y='7' width='1' height='1' fill='%23efffff'/>")
    rects.append(f"<rect x='{x_tip+3}' y='7' width='2' height='1' fill='%2397a8b9'/>")
    rects.append(f"<rect x='{xb}' y='7' width='1' height='1' fill='%23efffff'/>")
    # y=8
    rects.append(f"<rect x='{x_tip+3}' y='8' width='1' height='1' fill='%23efffff'/>")
    rects.append(f"<rect x='{x_tip+4}' y='8' width='1' height='1' fill='%2397a8b9'/>")
    rects.append(f"<rect x='{xb}' y='8' width='1' height='1' fill='%23efffff'/>")
    # y=9: lower back bevel (highlight)
    rects.append(f"<rect x='{xb-1}' y='9' width='2' height='1' fill='%23efffff'/>")
    return rects

def make_right_triangle(x_tip):
    # width is 6, so x_back = x_tip - 5
    xb = x_tip - 5
    rects = []
    # y=0: upper back bevel (dark)
    rects.append(f"<rect x='{xb}' y='0' width='2' height='1' fill='%234a5a6b'/>")
    # y=1
    rects.append(f"<rect x='{xb}' y='1' width='1' height='1' fill='%234a5a6b'/>")
    rects.append(f"<rect x='{xb+1}' y='1' width='1' height='1' fill='%2397a8b9'/>")
    rects.append(f"<rect x='{xb+2}' y='1' width='1' height='1' fill='%234a5a6b'/>")
    # y=2
    rects.append(f"<rect x='{xb}' y='2' width='1' height='1' fill='%234a5a6b'/>")
    rects.append(f"<rect x='{xb+1}' y='2' width='2' height='1' fill='%2397a8b9'/>")
    rects.append(f"<rect x='{xb+3}' y='2' width='1' height='1' fill='%234a5a6b'/>")
    # y=3
    rects.append(f"<rect x='{xb}' y='3' width='1' height='1' fill='%234a5a6b'/>")
    rects.append(f"<rect x='{xb+1}' y='3' width='3' height='1' fill='%2397a8b9'/>")
    rects.append(f"<rect x='{xb+4}' y='3' width='1' height='1' fill='%234a5a6b'/>")
    # y=4: tip
    rects.append(f"<rect x='{xb}' y='4' width='1' height='1' fill='%234a5a6b'/>")
    rects.append(f"<rect x='{xb+1}' y='4' width='4' height='1' fill='%2397a8b9'/>")
    rects.append(f"<rect x='{x_tip}' y='4' width='1' height='1' fill='%234a5a6b'/>")
    # y=5: tip bottom
    rects.append(f"<rect x='{xb}' y='5' width='1' height='1' fill='%234a5a6b'/>")
    rects.append(f"<rect x='{xb+1}' y='5' width='4' height='1' fill='%2397a8b9'/>")
    rects.append(f"<rect x='{x_tip}' y='5' width='1' height='1' fill='%23efffff'/>")
    # y=6
    rects.append(f"<rect x='{xb}' y='6' width='1' height='1' fill='%234a5a6b'/>")
    rects.append(f"<rect x='{xb+1}' y='6' width='3' height='1' fill='%2397a8b9'/>")
    rects.append(f"<rect x='{xb+4}' y='6' width='1' height='1' fill='%23efffff'/>")
    # y=7
    rects.append(f"<rect x='{xb}' y='7' width='1' height='1' fill='%234a5a6b'/>")
    rects.append(f"<rect x='{xb+1}' y='7' width='2' height='1' fill='%2397a8b9'/>")
    rects.append(f"<rect x='{xb+3}' y='7' width='1' height='1' fill='%23efffff'/>")
    # y=8
    rects.append(f"<rect x='{xb}' y='8' width='1' height='1' fill='%234a5a6b'/>")
    rects.append(f"<rect x='{xb+1}' y='8' width='1' height='1' fill='%2397a8b9'/>")
    rects.append(f"<rect x='{xb+2}' y='8' width='1' height='1' fill='%23efffff'/>")
    # y=9: lower back bevel (highlight)
    rects.append(f"<rect x='{xb}' y='9' width='2' height='1' fill='%23efffff'/>")
    return rects

rewind_svg = f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 10' shape-rendering='crispEdges'>{''.join(make_left_triangle(1) + make_left_triangle(7))}</svg>"
ffwd_svg = f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 10' shape-rendering='crispEdges'>{''.join(make_right_triangle(6) + make_right_triangle(12))}</svg>"

def print_grid(svg_str, name):
    print(f'=== {name} ===')
    raw = svg_str.replace('%23', '#')
    root = ET.fromstring(raw)
    grid = [[' ' for _ in range(14)] for _ in range(10)]
    for rect in root.findall('{http://www.w3.org/2000/svg}rect'):
        x = int(rect.get('x'))
        y = int(rect.get('y'))
        w = int(rect.get('width'))
        h = int(rect.get('height'))
        fill = rect.get('fill')
        char = '#' if fill == '#4a5a6b' else ('.' if fill == '#efffff' else 'o')
        for dy in range(h):
            for dx in range(w):
                grid[y+dy][x+dx] = char
    for y, row in enumerate(grid):
        print(f'{y}: ' + ''.join(row))

print_grid(rewind_svg, "REWIND (<<)")
print_grid(ffwd_svg, "FAST FORWARD (>>)")

with open('scripts/rewind_svg.txt', 'w') as f:
    f.write(f"data:image/svg+xml,{rewind_svg}")

with open('scripts/ffwd_svg.txt', 'w') as f:
    f.write(f"data:image/svg+xml,{ffwd_svg}")
