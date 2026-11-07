/**
 * 设置页「Devin 子代理」：密钥、模型、运行方式。
 *
 * 只依赖官方 Client 面：凭据走 `remote.credentials`，配置走 `remote.settings`
 * （按 revision 写入）。样式只用 `--dsw-alias-*` token，暗色主题自动跟随。
 */
window.__ModuleLoader__.load({
  id: '@omnisurge/dsh-subagent-devin',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const SECTION = 'settings.section';
    const SECTION_ID = 'devin-subagent';
    /** 兜底用的行 id；真实值以 settings.describe() 返回的 ns 为准（当前是 include:subagent-devin）。 */
    const FALLBACK_NS = 'subagent-devin';
    const CREDENTIAL_REF = 'WINDSURF_API_KEY';
    const LOCALE_NS = 'devin-subagent';

    const EN = {
      title: 'Devin subagent',
      intro: 'Hand a task to Devin and get its answer back in this session.',
      connection: 'Connection',
      configured: 'Configured',
      notConfigured: 'Not configured',
      apiKey: 'API key',
      keyPlaceholder: 'Paste your Devin API key',
      save: 'Save',
      replace: 'Replace',
      clear: 'Clear',
      check: 'Check connection',
      checkHint: 'Save a key first.',
      checking: 'Checking…',
      keyNote: 'The key lives in the credential store only. It is not shown here and never written to configuration.',
      checkNote: 'Checking performs a real handshake and sign-in with Devin; it does not spend a model call.',
      lastCheck: 'Last checked',
      models: 'Models',
      model: 'Model',
      followDefault: 'Account default',
      modelsFromCheck: 'The list comes from the last check. A misspelled name is silently replaced by Devin, so only these values are offered.',
      modelsNeedCheck: 'Check the connection to load the models this account can use.',
      behaviour: 'How it runs',
      permission: 'Subagent permissions',
      allow: 'May edit files',
      reject: 'Read-only',
      permissionWarn: 'With "May edit files", Devin changes files without an approval prompt. With "Read-only", its write requests are refused.',
      reset: 'Reset to defaults',
      connectUnavailable: 'This page cannot reach the application right now.',
      readFailed: 'Could not read the current settings.',
      writeFailed: 'Saving failed.',
      keyWriteFailed: 'Saving the key failed.',
      authenticated: 'signed in',
      authFailed: 'sign-in failed',
      modelsCount: 'models available',
      saved: 'Saved',
      refreshToken: 're-check',
    };

    const ZH = {
      title: 'Devin 子代理',
      intro: '把一个任务交给 Devin 执行，结果回到当前会话。',
      connection: '连接',
      configured: '已配置',
      notConfigured: '未配置',
      apiKey: 'API 密钥',
      keyPlaceholder: '粘贴 Devin 的 API key',
      save: '保存',
      replace: '替换',
      clear: '清除',
      check: '检查连接',
      checkHint: '先保存密钥，才能检查连接。',
      checking: '正在检查…',
      keyNote: '密钥只保存在系统凭据库里，页面不回显，也不会写进配置文件。',
      checkNote: '检查会真实访问 Devin（握手与认证），不产生模型调用费用。',
      lastCheck: '最近一次检查',
      models: '模型',
      model: '模型',
      followDefault: '跟随账号默认',
      modelsFromCheck: '列表来自最近一次检查；写错的名字会被 Devin 静默换成默认模型，所以这里只提供可选值。',
      modelsNeedCheck: '先检查连接，才能列出这个账号可用的模型。',
      behaviour: '运行方式',
      permission: '子代理权限',
      allow: '允许改文件',
      reject: '只读',
      permissionWarn: '选「允许改文件」时，Devin 的改动不会弹审批；选「只读」时它的写入请求会被拒绝。',
      reset: '恢复默认',
      connectUnavailable: '这个界面暂时连不上应用主进程。',
      readFailed: '读不到当前设置。',
      writeFailed: '保存失败。',
      keyWriteFailed: '密钥保存失败。',
      authenticated: '已登录',
      authFailed: '登录未成功',
      modelsCount: '个可用模型',
      saved: '已保存',
      refreshToken: '重新检查',
    };

    /** 页面样式：只用官方 token，不写字面色值。 */
    const CSS = `
.dsv-page{display:flex;flex-direction:column;gap:16px;max-width:720px}
.dsv-head h2{margin:0 0 6px;font-size:20px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsv-head p{margin:0;font-size:13px;color:var(--dsw-alias-label-secondary)}
.dsv-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:16px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:10px}
.dsv-card[data-muted=true]{background:var(--dsw-static-neutral-bluish-60);border-color:var(--dsw-alias-border-l1)}
.dsv-cardHead{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dsv-cardTitle{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsv-badge{display:inline-flex;align-items:center;gap:6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);padding:1px 8px;font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.dsv-badge[data-on=true]{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-tertiary)}
.dsv-dot{width:6px;height:6px;border-radius:50%;background:currentColor}
.dsv-dot[data-ok=true]{background:var(--dsw-alias-state-success-primary)}
.dsv-dot[data-bad=true]{background:var(--dsw-alias-state-error-primary)}
.dsv-label{font-size:13px;color:var(--dsw-alias-label-secondary)}
.dsv-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsv-input,.dsv-select{height:34px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 12px;font-size:13px;font-family:inherit;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-sizing:border-box}
.dsv-input{min-width:280px;flex:1 1 280px}
.dsv-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsv-input:disabled,.dsv-select:disabled{color:var(--dsw-alias-label-tertiary);background:var(--dsw-static-neutral-bluish-60)}
.dsv-select{min-width:240px}
.dsv-btn{height:34px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:none;font-family:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsv-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-tertiary)}
.dsv-btn:disabled{opacity:.4;cursor:default}
.dsv-btn[data-primary=true]{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1);border-color:transparent}
.dsv-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsv-warn{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-state-warn-primary)}
.dsv-error{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary)}
.dsv-foot{display:flex;justify-content:flex-end;gap:8px}
`;

    /** 读官方 Client 面；缺任何一面都返回 undefined，由页面给出可读状态。 */
    function remote(ctx, name) {
      try { return ctx.get(`remote.${name}`); } catch { return undefined; }
    }

    /** 找出本插件的 settings 命名空间（按 entry id，退化时按字段特征认）。 */
    function findNamespace(described) {
      const list = described?.namespaces ?? [];
      return list.find((entry) => entry.value?.credentialRef !== undefined)
        ?? list.find((entry) => entry.ns === FALLBACK_NS)
        ?? null;
    }

    function formatWhen(iso) {
      if (typeof iso !== 'string' || iso === '') return '';
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '';
      const pad = (value) => String(value).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function Page(props) {
      const t = props.t;
      const ctx = props.ctx;
      const [state, setState] = React.useState({ phase: 'loading', key: null, settings: null, ns: '', revision: undefined, error: '' });
      const [draft, setDraft] = React.useState('');
      const [busy, setBusy] = React.useState('');
      const [notice, setNotice] = React.useState('');

      const load = React.useCallback(async () => {
        const credentials = remote(ctx, 'credentials');
        const settings = remote(ctx, 'settings');
        if (credentials === undefined || settings === undefined) {
          setState({ phase: 'unavailable', key: null, settings: null, ns: '', revision: undefined, error: '' });
          return;
        }
        try {
          const [keyMap, described] = await Promise.all([
            credentials.describe([CREDENTIAL_REF]),
            settings.describe(),
          ]);
          const namespace = findNamespace(described);
          setState({
            phase: 'ready',
            key: keyMap?.[CREDENTIAL_REF] ?? null,
            settings: namespace?.value ?? null,
            ns: namespace?.ns ?? '',
            revision: namespace?.revision,
            error: '',
          });
        } catch (error) {
          setState({ phase: 'error', key: null, settings: null, ns: '', revision: undefined, error: error?.message ?? String(error) });
        }
      }, [ctx]);

      React.useEffect(() => { void load(); }, [load]);

      const saveKey = async () => {
        const value = draft.trim();
        if (value === '') return;
        setBusy('key');
        setNotice('');
        try {
          await remote(ctx, 'credentials').set(CREDENTIAL_REF, value);
          setDraft('');
          await load();
          setNotice(t('saved'));
        } catch (error) {
          setNotice(`${t('keyWriteFailed')} ${error?.message ?? ''}`.trim());
        } finally { setBusy(''); }
      };

      const clearKey = async () => {
        setBusy('key');
        try {
          await remote(ctx, 'credentials').unset(CREDENTIAL_REF);
          await load();
        } catch (error) {
          setNotice(`${t('keyWriteFailed')} ${error?.message ?? ''}`.trim());
        } finally { setBusy(''); }
      };

      const patchSettings = async (patch) => {
        if (state.ns === '') { setNotice(t('readFailed')); return; }
        setBusy('settings');
        setNotice('');
        try {
          await remote(ctx, 'settings').update(state.ns, patch, state.revision);
          await load();
          setNotice(t('saved'));
        } catch (error) {
          setNotice(`${t('writeFailed')} ${error?.message ?? ''}`.trim());
        } finally { setBusy(''); }
      };

      /** 重新检查：递增 refreshToken 让插件重启并探测，然后等结果落地。 */
      const recheck = async () => {
        if (state.ns === '') { setNotice(t('readFailed')); return; }
        setBusy('check');
        try {
          const before = state.settings?.probe?.at ?? '';
          await remote(ctx, 'settings').update(state.ns, { refreshToken: Date.now() }, state.revision);
          for (let attempt = 0; attempt < 40; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            const described = await remote(ctx, 'settings').describe();
            const namespace = findNamespace(described);
            const at = namespace?.value?.probe?.at ?? '';
            if (at !== '' && at !== before) {
              setState((current) => ({ ...current, settings: namespace.value, ns: namespace.ns, revision: namespace.revision }));
              return;
            }
          }
        } catch (error) {
          setNotice(`${t('writeFailed')} ${error?.message ?? ''}`.trim());
        } finally {
          setBusy('');
          void load();
        }
      };

      if (state.phase === 'loading') {
        return h('div', { className: 'dsv-page' }, h('p', { className: 'dsv-hint' }, '…'));
      }
      if (state.phase === 'unavailable' || state.phase === 'error') {
        return h('div', { className: 'dsv-page' },
          h('div', { className: 'dsv-head' }, h('h2', null, t('title'))),
          h('p', { className: 'dsv-error' }, state.phase === 'unavailable' ? t('connectUnavailable') : `${t('readFailed')} ${state.error}`));
      }

      const keyConfigured = state.key?.configured === true;
      const probe = state.settings?.probe ?? {};
      const models = Array.isArray(probe.models) ? probe.models : [];
      const checked = typeof probe.at === 'string' && probe.at !== '';
      const model = state.settings?.model ?? '';
      const permission = state.settings?.permission ?? 'allow';

      return h(React.Fragment, null,
        h('style', null, CSS),
        h('div', { className: 'dsv-page' },
          h('div', { className: 'dsv-head' },
            h('h2', null, t('title')),
            h('p', null, t('intro'))),

          // 连接
          h('section', { className: 'dsv-card' },
            h('div', { className: 'dsv-cardHead' },
              h('span', { className: 'dsv-cardTitle' }, t('connection')),
              h('span', { className: 'dsv-badge', 'data-on': keyConfigured ? 'true' : 'false' },
                h('span', { className: 'dsv-dot' }),
                keyConfigured ? t('configured') : t('notConfigured'))),
            h('span', { className: 'dsv-label' }, t('apiKey')),
            h('div', { className: 'dsv-row' },
              h('input', {
                className: 'dsv-input',
                type: 'password',
                autoComplete: 'off',
                placeholder: keyConfigured ? '••••••••' : t('keyPlaceholder'),
                value: draft,
                onChange: (event) => setDraft(event.target.value),
                disabled: busy === 'key',
              }),
              h('button', {
                className: 'dsv-btn', 'data-primary': 'true',
                onClick: saveKey,
                disabled: busy === 'key' || draft.trim() === '',
              }, keyConfigured ? t('replace') : t('save')),
              h('button', { className: 'dsv-btn', onClick: clearKey, disabled: busy === 'key' || !keyConfigured }, t('clear'))),
            h('p', { className: 'dsv-hint' }, t('keyNote')),
            h('div', { className: 'dsv-row' },
              h('button', { className: 'dsv-btn', onClick: recheck, disabled: busy === 'check' || !keyConfigured },
                busy === 'check' ? t('checking') : t('check')),
              checked && probe.ok === true
                ? h('span', { className: 'dsv-badge', 'data-on': 'true' },
                  h('span', {
                    className: 'dsv-dot',
                    'data-ok': probe.authenticated === true ? 'true' : 'false',
                    'data-bad': probe.authenticated === true ? 'false' : 'true',
                  }),
                  probe.authenticated === true
                    ? `${t('authenticated')} · ${models.length} ${t('modelsCount')}`
                    : t('authFailed'))
                : h('span', { className: 'dsv-hint' }, keyConfigured ? t('checkHint') : t('checkHint'))),
            h('p', { className: 'dsv-hint' }, t('checkNote')),
            checked ? h('p', { className: 'dsv-hint' }, `${t('lastCheck')}：${formatWhen(probe.at)}`) : null,
            checked && probe.error ? h('p', { className: 'dsv-error' }, probe.error) : null),

          // 模型
          h('section', { className: 'dsv-card', 'data-muted': models.length === 0 ? 'true' : 'false' },
            h('div', { className: 'dsv-cardHead' }, h('span', { className: 'dsv-cardTitle' }, t('models'))),
            h('span', { className: 'dsv-label' }, t('model')),
            h('div', { className: 'dsv-row' },
              h('select', {
                className: 'dsv-select',
                value: model,
                disabled: models.length === 0 || busy === 'settings',
                onChange: (event) => { void patchSettings({ model: event.target.value }); },
              },
              h('option', { value: '' }, `${t('followDefault')}${probe.current ? ` · ${probe.current}` : ''}`),
              models.map((entry) => h('option', { key: entry.value, value: entry.value }, entry.name || entry.value)))),
            h('p', { className: 'dsv-hint' }, models.length === 0 ? t('modelsNeedCheck') : t('modelsFromCheck'))),

          // 运行方式
          h('section', { className: 'dsv-card' },
            h('div', { className: 'dsv-cardHead' }, h('span', { className: 'dsv-cardTitle' }, t('behaviour'))),
            h('span', { className: 'dsv-label' }, t('permission')),
            h('div', { className: 'dsv-row' },
              h('select', {
                className: 'dsv-select',
                value: permission,
                disabled: busy === 'settings',
                onChange: (event) => { void patchSettings({ permission: event.target.value }); },
              },
              h('option', { value: 'allow' }, t('allow')),
              h('option', { value: 'reject' }, t('reject')))),
            h('p', { className: 'dsv-warn' }, t('permissionWarn'))),

          notice === '' ? null : h('p', { className: 'dsv-hint' }, notice)));
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 词典：locale 服务在就把中英文都注册上，运行时切换语言不用重挂页面。
        let t = (key) => ZH[key] ?? key;
        try {
          if (ctx.locale !== undefined) {
            const dispose = ctx.locale.register(LOCALE_NS, 'en', EN);
            const disposeZh = ctx.locale.register(LOCALE_NS, 'zh', ZH);
            const bound = ctx.locale.bind(LOCALE_NS);
            t = (key) => {
              const translated = bound(key);
              return translated === key ? (ZH[key] ?? key) : translated;
            };
            ctx.effect(() => () => { dispose(); disposeZh(); });
          }
        } catch { /* 没有 locale 服务时退回中文 */ }

        ctx.effect(() => ctx.slots.inject(SECTION, () => ctx.slots.register({
          name: SECTION,
          id: SECTION_ID,
          order: 25,
          label: () => t('title'),
        }, (props) => h(Page, { ...props, t, ctx }))));
      },
    };
  },
});
