const pageMousePos = new WeakMap();
/**
 * 获取当前页面记录的鼠标坐标，若未记录则默认返回初始点 (100, 100)
 */
export function getMousePosition(page) {
    return pageMousePos.get(page) ?? { x: 100, y: 100 };
}
export function setMousePosition(page, pos) {
    pageMousePos.set(page, pos);
}
/**
 * 缓动曲线: 平滑慢-快-慢 (Smoothstep)
 */
function easeInOut(t) {
    return t * t * (3 - 2 * t);
}
/**
 * 生成起点到终点的三次贝塞尔平滑轨迹点序列
 * B(t) = (1-t)^3 * P0 + 3(1-t)^2 * t * P1 + 3(1-t) * t^2 * P2 + t^3 * P3
 */
export function generateBezierPath(start, end, stepCount = 20) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.hypot(dx, dy);
    // 控制点偏离幅度：距离越大，弧度摆动范围适当增加
    const deviation = Math.min(dist * 0.35, 120);
    // 生成偏离主轴的两个中间控制点
    const p1 = {
        x: start.x + dx * 0.25 + (Math.random() - 0.5) * deviation,
        y: start.y + dy * 0.25 + (Math.random() - 0.5) * deviation,
    };
    const p2 = {
        x: start.x + dx * 0.75 + (Math.random() - 0.5) * deviation,
        y: start.y + dy * 0.75 + (Math.random() - 0.5) * deviation,
    };
    const path = [];
    const steps = Math.max(stepCount, 12);
    for (let i = 0; i <= steps; i++) {
        const rawT = i / steps;
        const t = easeInOut(rawT);
        const oneMinusT = 1 - t;
        // 三次贝塞尔参数方程
        const x = Math.pow(oneMinusT, 3) * start.x +
            3 * Math.pow(oneMinusT, 2) * t * p1.x +
            3 * oneMinusT * Math.pow(t, 2) * p2.x +
            Math.pow(t, 3) * end.x;
        const y = Math.pow(oneMinusT, 3) * start.y +
            3 * Math.pow(oneMinusT, 2) * t * p1.y +
            3 * oneMinusT * Math.pow(t, 2) * p2.y +
            Math.pow(t, 3) * end.y;
        // 微抖动高斯噪声 (终点阶段逐步收敛到 0)
        const jitterFactor = Math.sin(rawT * Math.PI) * 1.5;
        const jitterX = (Math.random() - 0.5) * jitterFactor;
        const jitterY = (Math.random() - 0.5) * jitterFactor;
        path.push({
            x: Math.round((x + jitterX) * 10) / 10,
            y: Math.round((y + jitterY) * 10) / 10,
        });
    }
    // 保证最终精准落在目标 end 点
    path[path.length - 1] = { x: end.x, y: end.y };
    return path;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * 拟人化平滑移动鼠标至指定像素坐标
 */
export async function humanMove(page, target, options = {}) {
    const current = getMousePosition(page);
    const speed = options.speed ?? "normal";
    const stepDelay = speed === "fast" ? 4 : speed === "slow" ? 18 : 8;
    const stepCount = options.steps ?? (speed === "fast" ? 12 : speed === "slow" ? 30 : 20);
    const path = generateBezierPath(current, target, stepCount);
    for (const pt of path) {
        await page.mouse.move(pt.x, pt.y);
        if (stepDelay > 0) {
            await sleep(stepDelay);
        }
    }
    setMousePosition(page, target);
}
/**
 * 拟人化微偏随机点击元素
 */
export async function humanClick(page, locator, options = {}) {
    let box = null;
    try {
        box = await locator.boundingBox();
    }
    catch {
        /* 无法获取几何位置则直接返回 false 回退原生 click */
    }
    if (!box || box.width <= 0 || box.height <= 0) {
        return false;
    }
    // 随机偏向中心区域的落点 (避免严格落在正中 0.5 触发机器人特征检测)
    const padX = box.width * 0.2;
    const padY = box.height * 0.2;
    const targetX = box.x + padX + Math.random() * (box.width - padX * 2);
    const targetY = box.y + padY + Math.random() * (box.height - padY * 2);
    await humanMove(page, { x: targetX, y: targetY }, options);
    // 拟人化按下与抬起时延 (45ms ~ 95ms)
    await page.mouse.down();
    await sleep(45 + Math.random() * 50);
    await page.mouse.up();
    return true;
}
//# sourceMappingURL=mouse.js.map