import asyncio
import websockets
import json

async def inspect():
    ws_url = 'ws://localhost:9222/devtools/page/51DB0892F63DAA25AF99C6C26195C53C'
    async with websockets.connect(ws_url) as ws:
        expr = """
        (() => {
            const btn = document.querySelector('[data-wa-btn="shuf"]');
            if (!btn) return { error: 'not found' };
            const rect = btn.getBoundingClientRect();
            const cs = window.getComputedStyle(btn);
            const before = window.getComputedStyle(btn, '::before');
            const after = window.getComputedStyle(btn, '::after');
            return {
                rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
                btn_cs: {width: cs.width, height: cs.height, padding: cs.padding, border: cs.border},
                before_cs: {content: before.content, width: before.width, height: before.height, left: before.left, top: before.top, background: before.backgroundColor},
                after_cs: {content: after.content, width: after.width, height: after.height, right: after.right, left: after.left, background: after.backgroundImage}
            };
        })()
        """
        await ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'returnByValue': True}}))
        res = json.loads(await ws.recv())
        print(json.dumps(res, indent=2))

if __name__ == '__main__':
    asyncio.run(inspect())
