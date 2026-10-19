/**
 * dsh-browser-view client half:
 * 1. "settings.section" -> A "🌐 浏览器" page in the official dsh settings
 *    dialog managing saved browser recordings with polished header & icon.
 * 2. "shell.overlay" -> Universal floating widget (FAB + live screenshot
 *    thumbnail panel + full-size inspection modal) rendered natively in both
 *    Electron desktop and web client.
 */

import { createElement, useEffect, useState, type MouseEvent } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'shell.overlay': { kind: 'list'; scope: 'root' }
  }
}

/* ------------------------------------------------------------------ */
/* Theme-aware palette                                                */
/* ------------------------------------------------------------------ */

interface Palette {
  primary: string
  secondary: string
  tertiary: string
  border: string
  hoverBg: string
  danger: string
}

const LIGHT: Palette = {
  primary: '#1f2937',
  secondary: '#4b5563',
  tertiary: '#6b7280',
  border: '#d8dde3',
  hoverBg: '#f1f4f7',
  danger: '#dc2626',
}

const DARK: Palette = {
  primary: '#f3f4f6',
  secondary: '#cbd5e1',
  tertiary: '#94a3b8',
  border: '#3f4a58',
  hoverBg: '#2a3240',
  danger: '#f87171',
}

/** Follow the host light/dark theme (body[data-ds-dark-theme]). */
function useDarkTheme(): boolean {
  const [dark, setDark] = useState<boolean>(
    () => typeof document !== 'undefined' && document.body?.getAttribute('data-ds-dark-theme') !== null,
  )
  useEffect(() => {
    if (typeof document === 'undefined') return
    const sync = (): void => setDark(document.body?.getAttribute('data-ds-dark-theme') !== null)
    const obs = new MutationObserver(sync)
    obs.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    return () => obs.disconnect()
  }, [])
  return dark
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const hh = ('0' + d.getHours()).slice(-2)
  const mm = ('0' + d.getMinutes()).slice(-2)
  return `${hh}:${mm}`
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface RecordingRow {
  name: string
  steps: number
  savedAt: number
  preview: string
}

interface RecordingDetail {
  name: string
  steps: Array<{ tool: string; args: unknown }>
}

interface BrowserStatus {
  open: boolean
  tabs?: number
  url?: string
  title?: string
  channel?: string
}

interface BrowserOp {
  tool: string
  ok: boolean
  ms: number
  ts: number
  error?: string
}

interface NavHistoryItem {
  url: string
  title?: string
  ts: number
}

interface LatestRun {
  runId: string
  ts: number
  source: string
  passed: number
  total: number
  failed: number
  healedCount: number
  row?: number
}

/* ------------------------------------------------------------------ */
/* UI Styles                                                          */
/* ------------------------------------------------------------------ */

function styleFor(p: Palette) {
  return {
    row: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      minWidth: 0,
    } as React.CSSProperties,
    label: {
      flex: 1,
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      fontSize: '13px',
      color: p.primary,
      cursor: 'pointer',
    } as React.CSSProperties,
    meta: {
      color: p.tertiary,
      fontSize: '12px',
      whiteSpace: 'nowrap',
    } as React.CSSProperties,
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
    } as React.CSSProperties,
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
    } as React.CSSProperties,
    itemBox: {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      border: `1px solid ${p.border}`,
      borderRadius: '8px',
      padding: '8px 10px',
    } as React.CSSProperties,
    stepsBox: {
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      borderTop: `1px solid ${p.border}`,
      paddingTop: '6px',
    } as React.CSSProperties,
    stepLine: {
      display: 'flex',
      gap: '8px',
      fontSize: '13px',
      lineHeight: '1.7',
      color: p.secondary,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    } as React.CSSProperties,
    toolName: {
      color: p.primary,
      flex: 'none',
      fontWeight: 500,
    } as React.CSSProperties,
    stepArgs: {
      flex: 1,
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      color: p.secondary,
    } as React.CSSProperties,
    empty: {
      color: p.tertiary,
      fontSize: '12px',
      textAlign: 'center',
      padding: '12px 0',
    } as React.CSSProperties,
    root: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      maxWidth: '720px',
    } as React.CSSProperties,
    heading: {
      color: p.tertiary,
      fontSize: '12px',
      lineHeight: '1.6',
    } as React.CSSProperties,
  }
}

/* ------------------------------------------------------------------ */
/* 1. Universal Floating Overlay Component (shell.overlay slot)       */
/* ------------------------------------------------------------------ */

function BrowserFloatingOverlay() {
  const dark = useDarkTheme()
  const p = dark ? DARK : LIGHT
  const [base, setBase] = useState<string>('/browser')
  const [isOpen, setIsOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [status, setStatus] = useState<BrowserStatus | null>(null)
  const [ops, setOps] = useState<BrowserOp[]>([])
  const [history, setHistory] = useState<NavHistoryItem[]>([])
  const [shotVersion, setShotVersion] = useState(Date.now())
  const [lastRun, setLastRun] = useState<LatestRun | null>(null)

  // Discover the node-half base path
  useEffect(() => {
    let alive = true
    fetch('/__dsh-browser-view__/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { basePath?: unknown }) => {
        if (alive && typeof d.basePath === 'string' && d.basePath) setBase(d.basePath.replace(/\/+$/, ''))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // Poll status & operations history
  useEffect(() => {
    let alive = true
    const poll = () => {
      fetch(`${base}/status`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((s: BrowserStatus | null) => {
          if (!alive) return
          setStatus(s)
          if (s?.open) setShotVersion(Date.now())
        })
        .catch(() => { if (alive) setStatus(null) })

      fetch(`${base}/log`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { calls?: BrowserOp[] } | null) => {
          if (!alive) return
          if (d && Array.isArray(d.calls)) setOps(d.calls.slice(0, 8))
        })
        .catch(() => {})

      fetch(`${base}/runs/latest`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { run?: LatestRun | null } | null) => {
          if (!alive) return
          setLastRun(d?.run ?? null)
        })
        .catch(() => {})
    }

    poll()
    const timer = setInterval(poll, 3000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [base])

  // Poll navigation history when modal is open
  useEffect(() => {
    if (!modalOpen) return
    let alive = true
    const pollHistory = () => {
      fetch(`${base}/history`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { history?: NavHistoryItem[] } | null) => {
          if (alive && d && Array.isArray(d.history)) setHistory(d.history)
        })
        .catch(() => {})
      setShotVersion(Date.now())
    }
    pollHistory()
    const timer = setInterval(pollHistory, 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [modalOpen, base])

  // Listen to Escape for modal close
  useEffect(() => {
    if (!modalOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModalOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [modalOpen])

  const shotSrc = `${base}/screenshot?v=${shotVersion}`

  return createElement(
    'div',
    {
      id: 'dsh-browser-client-overlay',
      style: {
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 2147483000,
      },
    },
    // FAB Floating Button
    createElement(
      'button',
      {
        type: 'button',
        title: '浏览器自动化与实时画面',
        onClick: () => setIsOpen((v) => !v),
        style: {
          position: 'fixed',
          right: '16px',
          bottom: '16px',
          width: '42px',
          height: '42px',
          borderRadius: '999px',
          border: `1px solid ${p.border}`,
          background: dark ? '#1e2430' : '#ffffff',
          color: p.primary,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '18px',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
          pointerEvents: 'auto',
          userSelect: 'none',
        },
      },
      '🌐',
    ),
    // Floating Panel
    isOpen &&
      createElement(
        'div',
        {
          style: {
            position: 'fixed',
            right: '16px',
            bottom: '66px',
            width: '320px',
            maxHeight: '72vh',
            overflowY: 'auto',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            border: `1px solid ${p.border}`,
            borderRadius: '12px',
            background: dark ? '#181e29' : '#ffffff',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
            padding: '12px',
            pointerEvents: 'auto',
          },
        },
        // Status Row
        createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' } },
          createElement('span', {
            style: {
              width: '8px',
              height: '8px',
              borderRadius: '999px',
              flex: 'none',
              background: status?.open ? '#10b981' : '#ef4444',
            },
          }),
          createElement(
            'span',
            {
              style: {
                flex: 1,
                minWidth: 0,
                color: p.primary,
                fontSize: '13px',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              },
            },
            '浏览器实时画面',
          ),
          createElement(
            'span',
            {
              style: {
                color: p.secondary,
                fontSize: '12px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '160px',
              },
            },
            status === null
              ? '未启用'
              : status.open
                ? `${status.tabs ?? 1} 标签 · ${(status.url || '').slice(0, 20)}`
                : '未打开',
          ),
        ),
        // Live Screenshot Thumbnail
        status?.open
          ? createElement('img', {
              src: shotSrc,
              alt: '实时画面',
              title: '点击放大查看实时大屏与访问历史',
              onClick: () => setModalOpen(true),
              style: {
                width: '100%',
                maxHeight: '160px',
                objectFit: 'cover',
                borderRadius: '8px',
                border: `1px solid ${p.border}`,
                cursor: 'pointer',
                background: dark ? '#10141c' : '#f8fafc',
              },
            })
          : createElement(
              'div',
              {
                style: {
                  color: p.tertiary,
                  fontSize: '11px',
                  lineHeight: '1.5',
                  padding: '8px',
                  background: dark ? '#121620' : '#f8fafc',
                  borderRadius: '6px',
                },
              },
              '浏览器尚未启动。在对话中让 Agent 调用 browser_open 即可呈现画面。',
            ),
        // Recent Operations
        ops.length > 0 &&
          createElement(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
                borderTop: `1px solid ${p.border}`,
                paddingTop: '6px',
                marginTop: '2px',
              },
            },
            createElement(
              'div',
              { style: { color: p.tertiary, fontSize: '11px', fontWeight: 500, marginBottom: '2px' } },
              `最近操作 (${ops.length} 条)`,
            ),
            ops.map((op, i) =>
              createElement(
                'div',
                {
                  key: i,
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '12px',
                    color: p.secondary,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  },
                },
                createElement(
                  'span',
                  {
                    style: {
                      flex: 'none',
                      color: op.ok ? '#10b981' : '#ef4444',
                      fontWeight: 600,
                    },
                  },
                  op.ok ? '✓' : '✗',
                ),
                createElement('span', { style: { color: p.tertiary, fontSize: '11px', flex: 'none' } }, fmtTime(op.ts)),
                createElement(
                  'span',
                  {
                    style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
                    title: `${op.tool}${op.error ? `: ${op.error}` : ''}`,
                  },
                  `${op.tool}${op.error ? `: ${op.error}` : ''}`,
                ),
              ),
            ),
          ),
        // 最近回归运行(replay/batch)
        lastRun !== null &&
          createElement(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                borderTop: `1px solid ${p.border}`,
                paddingTop: '6px',
                marginTop: '2px',
                fontSize: '12px',
                color: p.secondary,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              },
              title: `runId=${lastRun.runId} · browser_report 可导出报告`,
            },
            createElement('span', { style: { flex: 'none', color: p.tertiary, fontSize: '11px' } }, '最近回归'),
            createElement(
              'span',
              {
                style: {
                  flex: 'none',
                  fontWeight: 600,
                  color: lastRun.failed === 0 ? '#10b981' : '#ef4444',
                },
              },
              lastRun.failed === 0 ? '✓' : '✗',
            ),
            createElement(
              'span',
              { style: { overflow: 'hidden', textOverflow: 'ellipsis' } },
              `${lastRun.source}${lastRun.row !== undefined ? ` 行${lastRun.row}` : ''} ${lastRun.passed}/${lastRun.total}${lastRun.healedCount > 0 ? ` · 自愈${lastRun.healedCount}` : ''} · ${new Date(lastRun.ts).toLocaleTimeString('zh-CN', { hour12: false })}`,
            ),
          ),
      ),
    // Full-screen Modal Box
    modalOpen &&
      createElement(
        'div',
        {
          onClick: (e: MouseEvent) => {
            if (e.target === e.currentTarget) setModalOpen(false)
          },
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 2147483001,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            background: 'rgba(0, 0, 0, 0.65)',
            pointerEvents: 'auto',
          },
        },
        createElement(
          'div',
          {
            style: {
              width: 'min(1100px, 94vw)',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              border: `1px solid ${p.border}`,
              borderRadius: '12px',
              background: dark ? '#181e29' : '#ffffff',
              padding: '16px',
              boxShadow: '0 16px 64px rgba(0, 0, 0, 0.4)',
            },
          },
          // Header
          createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            createElement(
              'span',
              {
                style: {
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: p.primary,
                  fontSize: '14px',
                  fontWeight: 600,
                },
              },
              status?.open ? `${status.title || ''} (${status.url || ''})` : '浏览器实时大屏',
            ),
            createElement(
              'button',
              {
                type: 'button',
                onClick: () => setModalOpen(false),
                style: {
                  width: '28px',
                  height: '28px',
                  border: `1px solid ${p.border}`,
                  borderRadius: '6px',
                  background: 'transparent',
                  color: p.secondary,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                },
              },
              '✕',
            ),
          ),
          // Large Screenshot
          status?.open
            ? createElement('img', {
                src: shotSrc,
                alt: '浏览器大图',
                style: {
                  width: '100%',
                  maxHeight: '55vh',
                  objectFit: 'contain',
                  borderRadius: '8px',
                  border: `1px solid ${p.border}`,
                  background: dark ? '#10141c' : '#f8fafc',
                },
              })
            : createElement(
                'div',
                {
                  style: {
                    color: p.tertiary,
                    fontSize: '13px',
                    textAlign: 'center',
                    padding: '32px 0',
                  },
                },
                '浏览器尚未打开',
              ),
          // History Section
          history.length > 0 &&
            createElement(
              'div',
              {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  maxHeight: '22vh',
                  overflowY: 'auto',
                  borderTop: `1px solid ${p.border}`,
                  paddingTop: '8px',
                },
              },
              createElement(
                'div',
                { style: { color: p.tertiary, fontSize: '12px', fontWeight: 500 } },
                `访问历史 (${history.length} 条，点击在新标签打开)`,
              ),
              history.map((h, i) =>
                createElement(
                  'a',
                  {
                    key: i,
                    href: h.url,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    style: {
                      display: 'flex',
                      gap: '8px',
                      alignItems: 'center',
                      color: p.secondary,
                      fontSize: '12px',
                      textDecoration: 'none',
                      borderRadius: '6px',
                      padding: '4px 6px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    },
                  },
                  createElement('span', { style: { color: p.tertiary, flex: 'none' } }, fmtTime(h.ts)),
                  createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, h.title || h.url),
                ),
              ),
            ),
        ),
      ),
  )
}

/* ------------------------------------------------------------------ */
/* 2. Settings Section Component (settings.section seat)              */
/* ------------------------------------------------------------------ */

function BrowserSettingsSection(_props: SettingsSectionOwnerProps) {
  const dark = useDarkTheme()
  const p = dark ? DARK : LIGHT
  const S = styleFor(p)
  const [base, setBase] = useState<string>('/browser')
  const [list, setList] = useState<RecordingRow[] | null>(null)
  const [error, setError] = useState<string>('')
  const [expanded, setExpanded] = useState<Record<string, RecordingDetail | 'loading' | 'failed' | undefined>>({})

  useEffect(() => {
    let alive = true
    fetch('/__dsh-browser-view__/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { basePath?: unknown }) => {
        if (alive && typeof d.basePath === 'string' && d.basePath) setBase(d.basePath.replace(/\/+$/, ''))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    setList(null)
    setError('')
    fetch(`${base}/recordings`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { recordings?: RecordingRow[] }) => {
        if (alive) setList(d.recordings ?? [])
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => { alive = false }
  }, [base])

  const toggleDetail = (name: string): void => {
    setExpanded((prev) => {
      const current = prev[name]
      if (current !== undefined && current !== 'loading') {
        const next = { ...prev }
        delete next[name]
        return next
      }
      fetch(`${base}/recordings/detail?name=${encodeURIComponent(name)}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d: RecordingDetail) => setExpanded((pr) => ({ ...pr, [name]: d })))
        .catch(() => setExpanded((pr) => ({ ...pr, [name]: 'failed' })))
      return { ...prev, [name]: 'loading' }
    })
  }

  const remove = (name: string): void => {
    fetch(`${base}/recordings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(() => {
        setList((prev) => (prev === null ? prev : prev.filter((row) => row.name !== name)))
        setExpanded((prev) => {
          const next = { ...prev }
          delete next[name]
          return next
        })
      })
      .catch(() => {})
  }

  return createElement(
    'div',
    { style: S.root },
    // Modern Settings Header with Browser Icon
    createElement(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          paddingBottom: '12px',
          marginBottom: '6px',
          borderBottom: `1px solid ${p.border}`,
        },
      },
      createElement(
        'div',
        {
          style: {
            width: '38px',
            height: '38px',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: dark ? '#222938' : '#eef2f6',
            border: `1px solid ${p.border}`,
            fontSize: '20px',
            flexShrink: 0,
          },
        },
        '🌐',
      ),
      createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
        createElement(
          'div',
          { style: { fontSize: '15px', fontWeight: 600, color: p.primary } },
          '浏览器自动化与录制',
        ),
        createElement(
          'div',
          { style: { fontSize: '12px', color: p.tertiary } },
          '共享 Playwright 浏览器自动化、测试原语、操作轨迹与回归录制管理',
        ),
      ),
    ),
    createElement(
      'div',
      { style: S.heading },
      '已保存的操作录制 (agent 在对话中用 browser_record save <name> 创建，存储于 $DSH_HOME/.dsh-browser/recordings)',
    ),
    error
      ? createElement('div', { style: S.empty }, `加载失败: ${error}`)
      : list === null
        ? createElement('div', { style: S.empty }, '加载中…')
        : list.length === 0
          ? createElement('div', { style: S.empty }, '暂无录制。让 agent 跑完一轮流程后 browser_record save <name> 创建。')
          : list.map((row) => {
              const detail = expanded[row.name]
              return createElement(
                'div',
                { key: row.name, style: S.itemBox },
                createElement(
                  'div',
                  { style: S.row },
                  createElement(
                    'span',
                    { style: S.label, title: '点击展开步骤', onClick: () => toggleDetail(row.name) },
                    row.name,
                  ),
                  createElement(
                    'span',
                    { style: S.meta },
                    `${row.steps} 步 · ${new Date(row.savedAt).toLocaleString()}`,
                  ),
                  createElement(
                    'button',
                    { style: S.btn, onClick: () => toggleDetail(row.name) },
                    detail === undefined ? '展开' : '收起',
                  ),
                  createElement('button', { style: S.delBtn, onClick: () => remove(row.name) }, '删除'),
                ),
                detail === undefined
                  ? null
                  : detail === 'loading'
                    ? createElement('div', { style: S.empty }, '加载中…')
                    : createElement(
                        'div',
                        { style: S.stepsBox },
                        detail === 'failed'
                          ? createElement('div', { style: S.empty }, '加载失败')
                          : detail.steps.length === 0
                          ? createElement('div', { style: S.empty }, '(空步骤)')
                          : detail.steps.map((step, index) =>
                              createElement(
                                'div',
                                { key: `${row.name}-${index}`, style: S.stepLine, title: `${step.tool} ${JSON.stringify(step.args ?? {})}` },
                                createElement('span', { style: S.meta }, `#${index}`),
                                createElement('span', { style: S.toolName }, step.tool),
                                createElement(
                                  'span',
                                  { style: S.stepArgs },
                                  JSON.stringify(step.args ?? {}),
                                ),
                              ),
                            ),
                    ),
              )
            }),
    list !== null && createElement('div', { style: S.heading }, '提示:agent 在对话中用 browser_record save <name> 创建录制。'),
  )
}

/* ------------------------------------------------------------------ */
/* Plugin entry                                                        */
/* ------------------------------------------------------------------ */

/** Required services (cordis fiber inject). */
export const inject = ['slots']

/**
 * Register the browser extension components:
 * 1. settings.section -> "🌐 浏览器" page in settings
 * 2. shell.overlay -> Universal floating live screenshot widget (Desktop & Web)
 */
export function apply(ctx: ClientContext): void {
  // 1. Settings page with browser icon
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'browser',
    order: 40,
    label: '🌐 浏览器',
  }, BrowserSettingsSection))

  // 2. Universal floating widget (Desktop & Web)
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-browser-overlay',
    order: 100,
  }, BrowserFloatingOverlay))
}
