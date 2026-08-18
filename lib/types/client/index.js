/**
 * dsh-browser browser half: a "浏览器" page in the official dsh settings
 * dialog (settings.section seat) that manages saved browser recordings —
 * list, expand steps, delete. Data flows to the node half through the
 * plugin's own same-origin HTTP endpoints (base path discovered from
 * /__dsh-browser__/config).
 */
import { createElement, useEffect, useState } from 'react';
const LIGHT = {
    primary: '#1f2937',
    secondary: '#4b5563',
    tertiary: '#6b7280',
    border: '#d8dde3',
    hoverBg: '#f1f4f7',
    danger: '#dc2626',
};
const DARK = {
    primary: '#f3f4f6',
    secondary: '#cbd5e1',
    tertiary: '#94a3b8',
    border: '#3f4a58',
    hoverBg: '#2a3240',
    danger: '#f87171',
};
/** Follow the host light/dark theme (body[data-ds-dark-theme]). */
function useDarkTheme() {
    const [dark, setDark] = useState(() => typeof document !== 'undefined' && document.body?.getAttribute('data-ds-dark-theme') !== null);
    useEffect(() => {
        if (typeof document === 'undefined')
            return;
        const sync = () => setDark(document.body?.getAttribute('data-ds-dark-theme') !== null);
        const obs = new MutationObserver(sync);
        obs.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
        return () => obs.disconnect();
    }, []);
    return dark;
}
/* ------------------------------------------------------------------ */
/* UI — all colors come from the palette above (theme-aware).          */
/* ------------------------------------------------------------------ */
function styleFor(p) {
    return {
        row: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            minWidth: 0,
        },
        label: {
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: '13px',
            color: p.primary,
            cursor: 'pointer',
        },
        meta: {
            color: p.tertiary,
            fontSize: '12px',
            whiteSpace: 'nowrap',
        },
        btn: {
            height: '24px',
            padding: '0 10px',
            border: `1px solid ${p.border}`,
            borderRadius: '6px',
            background: 'transparent',
            color: p.secondary,
            font: 'inherit',
            fontSize: '12px',
            cursor: 'pointer',
        },
        delBtn: {
            height: '24px',
            padding: '0 10px',
            border: `1px solid ${p.border}`,
            borderRadius: '6px',
            background: 'transparent',
            color: p.danger,
            font: 'inherit',
            fontSize: '12px',
            cursor: 'pointer',
        },
        itemBox: {
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            border: `1px solid ${p.border}`,
            borderRadius: '8px',
            padding: '8px 10px',
        },
        stepsBox: {
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            borderTop: `1px solid ${p.border}`,
            paddingTop: '6px',
            // 不设 max-height/overflow:官方 .options 内容列已是滚动容器,
            // 内容自然撑开由它统一滚动(此前 30vh 双重滚动导致长录制看不清)。
        },
        stepLine: {
            display: 'flex',
            gap: '8px',
            fontSize: '13px',
            lineHeight: '1.7',
            color: p.secondary,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
        },
        toolName: {
            color: p.primary,
            flex: 'none',
            fontWeight: 500,
        },
        stepArgs: {
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color: p.secondary,
        },
        empty: {
            color: p.tertiary,
            fontSize: '12px',
            textAlign: 'center',
            padding: '12px 0',
        },
        root: {
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            maxWidth: '720px',
        },
        heading: {
            color: p.tertiary,
            fontSize: '12px',
            lineHeight: '1.6',
        },
    };
}
/* ------------------------------------------------------------------ */
/* Section component                                                   */
/* ------------------------------------------------------------------ */
function BrowserSettingsSection(_props) {
    const dark = useDarkTheme();
    const S = styleFor(dark ? DARK : LIGHT);
    const [base, setBase] = useState('/browser');
    const [list, setList] = useState(null);
    const [error, setError] = useState('');
    // undefined=收起, 'loading'=加载中, 'failed'=加载失败, 对象=已展开。
    const [expanded, setExpanded] = useState({});
    // Discover the node-half base path (configurable via cordis.patch.yml).
    useEffect(() => {
        let alive = true;
        fetch('/__dsh-browser__/config', { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then((d) => {
            if (alive && typeof d.basePath === 'string' && d.basePath)
                setBase(d.basePath.replace(/\/+$/, ''));
        })
            .catch(() => { });
        return () => { alive = false; };
    }, []);
    // Load the recording list whenever the base path settles.
    useEffect(() => {
        let alive = true;
        setList(null);
        setError('');
        fetch(`${base}/recordings`, { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then((d) => {
            if (alive)
                setList(d.recordings ?? []);
        })
            .catch((e) => {
            if (alive)
                setError(e instanceof Error ? e.message : String(e));
        });
        return () => { alive = false; };
    }, [base]);
    const toggleDetail = (name) => {
        setExpanded((prev) => {
            const current = prev[name];
            if (current !== undefined && current !== 'loading') {
                // 展开中(对象或失败态)→ 收起
                const next = { ...prev };
                delete next[name];
                return next;
            }
            // 收起或加载中 → 发起加载,标记 loading
            fetch(`${base}/recordings/detail?name=${encodeURIComponent(name)}`, { cache: 'no-store' })
                .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
                .then((d) => setExpanded((p) => ({ ...p, [name]: d })))
                .catch(() => setExpanded((p) => ({ ...p, [name]: 'failed' })));
            return { ...prev, [name]: 'loading' };
        });
    };
    const remove = (name) => {
        fetch(`${base}/recordings`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name }),
        })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then(() => {
            setList((prev) => (prev === null ? prev : prev.filter((row) => row.name !== name)));
            setExpanded((prev) => {
                const next = { ...prev };
                delete next[name];
                return next;
            });
        })
            .catch(() => { });
    };
    const root = {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        maxWidth: '720px',
    };
    const heading = {
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: '12px',
        lineHeight: '1.6',
    };
    return createElement('div', { style: S.root }, createElement('div', { style: S.heading }, '浏览器录制(agent 用 browser_record save <name> 创建,存储于 $DSH_HOME/.dsh-browser/recordings)'), error
        ? createElement('div', { style: S.empty }, `加载失败: ${error}`)
        : list === null
            ? createElement('div', { style: S.empty }, '加载中…')
            : list.length === 0
                ? createElement('div', { style: S.empty }, '暂无录制。让 agent 跑完一轮流程后 browser_record save <name> 创建。')
                : list.map((row) => {
                    const detail = expanded[row.name];
                    return createElement('div', { key: row.name, style: S.itemBox }, createElement('div', { style: S.row }, createElement('span', { style: S.label, title: '点击展开步骤', onClick: () => toggleDetail(row.name) }, row.name), createElement('span', { style: S.meta }, `${row.steps} 步 · ${new Date(row.savedAt).toLocaleString()}`), createElement('button', { style: S.btn, onClick: () => toggleDetail(row.name) }, detail === undefined ? '展开' : '收起'), createElement('button', { style: S.delBtn, onClick: () => remove(row.name) }, '删除')), detail === undefined
                        ? null
                        : detail === 'loading'
                            ? createElement('div', { style: S.empty }, '加载中…')
                            : createElement('div', { style: S.stepsBox }, detail === 'failed'
                                ? createElement('div', { style: S.empty }, '加载失败')
                                : detail.steps.length === 0
                                    ? createElement('div', { style: S.empty }, '(空步骤)')
                                    : detail.steps.map((step, index) => createElement('div', { key: `${row.name}-${index}`, style: S.stepLine, title: `${step.tool} ${JSON.stringify(step.args ?? {})}` }, createElement('span', { style: S.meta }, `#${index}`), createElement('span', { style: S.toolName }, step.tool), createElement('span', { style: S.stepArgs }, JSON.stringify(step.args ?? {}))))));
                }), list !== null && createElement('div', { style: S.heading }, '提示:agent 在对话中用 browser_record save <name> 创建录制。'));
}
/* ------------------------------------------------------------------ */
/* Plugin entry                                                        */
/* ------------------------------------------------------------------ */
/** Required services (cordis fiber inject). */
export const inject = ['slots'];
/**
 * Register the "浏览器" settings page: nav entry + recordings management.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx) {
    ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'browser',
        order: 40,
        label: '浏览器',
    }, BrowserSettingsSection));
}
//# sourceMappingURL=index.js.map