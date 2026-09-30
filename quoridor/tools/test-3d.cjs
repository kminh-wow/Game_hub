// Browser smoke test with simulated server messages; this does not test FastAPI.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.sent = [];
    window.WebSocket = class {
      static OPEN = 1;
      constructor() { this.readyState = 1; window.socket = this; setTimeout(() => this.onopen?.(), 0); }
      send(text) {
        const data = JSON.parse(text); window.sent.push(data);
        if (data.type === 'start_ai_game' || data.type === 'start_learn_game') {
          this.onmessage({ data: JSON.stringify({ type: 'room_created', player: 1, mode: 'ai' }) });
          window.state = { type: 'state', mode: data.type === 'start_learn_game' ? 'learn' : 'ai', difficulty: 'easy', pawns: { 1: [0, 4], 2: [8, 4] }, walls: [], wallsLeft: { 1: 10, 2: 10 }, turn: 1, winner: null, legalMoves: [[1, 4], [0, 3], [0, 5]], analysis: [] };
          this.emit(window.state);
        }
      }
      emit(state) { this.onmessage({ data: JSON.stringify(state) }); }
    };
  });
  await page.goto('http://127.0.0.1:8000');
  await page.waitForFunction(() => document.querySelector('#board-status').textContent === '3D 준비 완료');
  await page.evaluate(async () => {
    const { Board3D } = await import('/board3d.js');
    const original = Board3D.prototype.apply;
    Board3D.prototype.apply = function (...args) { window.board = this; return original.apply(this, args); };
  });
  await page.locator('.btn-ai-diff[data-difficulty="easy"]').click();
  await page.waitForFunction(() => window.board?.interactive);
  async function clickWorld(x, z) {
    const point = await page.evaluate(async ({ x, z }) => {
      const THREE = await import('three'); const b = window.board;
      const p = new THREE.Vector3(x, .45, z).project(b.camera); const rect = b.renderer.domElement.getBoundingClientRect();
      return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
    }, { x, z });
    await page.mouse.click(point.x, point.y);
  }
  await page.screenshot({ path: 'test-results/board-desktop.png' });
  await clickWorld(0, -3);
  assert.deepEqual(await page.evaluate(() => window.sent.at(-1)), { type: 'move', to: [1, 4] });
  await clickWorld(0, -3);
  assert.equal(await page.evaluate(() => window.sent.filter(m => m.type === 'move').length), 1, 'duplicate click blocked');
  await page.evaluate(() => { state.pawns[1] = [1, 4]; state.turn = 2; socket.emit(state); });
  await page.waitForFunction(() => board.pawns[1].active.getClip().name === 'Walk');
  await page.waitForFunction(() => board.state?.pawns[1][0] === 1);
  assert.equal(await page.evaluate(() => board.pawns[1].root.position.z), -3);
  // Closely spaced server states must animate in order.
  await page.evaluate(() => {
    state.pawns[2] = [2, 4]; state.turn = 1; state.legalMoves = [[3, 4]]; socket.emit(state);
    state.pawns[1] = [3, 4]; state.turn = 2; socket.emit(state);
  });
  await page.waitForFunction(() => board.pawns[1].active.getClip().name === 'Jump');
  await page.waitForFunction(() => board.state?.pawns[1][0] === 3);
  assert.equal(await page.evaluate(() => board.pawns[1].root.position.y), .45);
  await page.evaluate(() => { state.turn = 1; socket.emit(state); });
  await page.waitForFunction(() => board.interactive);
  await page.getByRole('button', { name: '벽 설치', exact: true }).click();
  await page.keyboard.press('r'); await clickWorld(-2.5, -1.5);
  assert.deepEqual(await page.evaluate(() => window.sent.at(-1)), { type: 'place_wall', r: 2, c: 1, orientation: 'V' });
  await page.evaluate(() => { socket.emit({ type: 'error', message: 'wall overlaps an existing wall' }); });
  await page.waitForFunction(() => board.interactive);
  assert.equal(await page.evaluate(() => board.walls.size), 0, 'rejected wall not rendered');
  await clickWorld(-2.5, -1.5);
  await page.evaluate(() => { state.walls.push({ r: 2, c: 1, orientation: 'V', player: 1 }); state.wallsLeft[1]--; socket.emit(state); });
  await page.waitForFunction(() => board.interactive && board.walls.size === 1);
  assert.equal(await page.evaluate(() => [...board.walls.values()][0].scale.y), 1);
  await page.evaluate(() => { state.mode = 'learn'; state.analysis = [{ kind: 'move', to: [4, 4], label: '최선의 수', reasons: ['테스트 설명'], trace: ['테스트 계산'] }]; state.legalMoves = [[4, 4]]; socket.emit(state); });
  await page.waitForFunction(() => board.interactive && board.labels.visible);
  await page.getByRole('button', { name: '말 이동', exact: true }).click();
  await clickWorld(0, 0);
  await page.evaluate(() => { socket.emit({ type: 'error', message: 'test reset' }); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile overflow');
  await page.screenshot({ path: 'test-results/board-mobile.png', fullPage: true });
  await page.evaluate(() => { state.pawns[1] = [8, 4]; state.winner = 1; state.legalMoves = []; socket.emit(state); });
  await page.waitForFunction(() => board.pawns[1].active.getClip().name === 'Win');
  await page.waitForSelector('#result-modal:not(.hidden)');
  assert.equal(await page.locator('#result-text').textContent(), '승리했습니다!');
  assert.deepEqual(errors, []);
  console.log('PASS: GLB load, move input, duplicate blocking, Walk, queued Jump, rejected/accepted wall, learning mode, mobile layout, Win/result. Simulated server only.');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
