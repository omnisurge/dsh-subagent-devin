/**
 * 设置页「Devin 子代理」。
 *
 * 三态：未连接 / 检测中 / 已连接。连接卡提供两条路——用 Devin 账号登录
 * （复制命令到终端）或直接粘贴 `devin-` 开头的密钥；另有一个按钮请 Host
 * 打开凭据文件所在位置。
 *
 * 只依赖官方 Client 面：密钥走 `remote.credentials`，配置走 `remote.settings`。
 * 页面不能直接调用 Host，所以「重新检测」和「打开凭据位置」都是写一个计数字段，
 * 由插件行重载后执行——这两处会闪一下，是刻意的取舍（不引 typert 生成链）。
 */
window.__ModuleLoader__.load({
  id: '@omnisurge/dsh-subagent-devin',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const SECTION = 'settings.section';
    const SECTION_ID = 'devin-subagent';
    const CREDENTIAL_REF = 'WINDSURF_API_KEY';
    const LOCALE_NS = 'devin-subagent';
    /** 插件行的 entry id 就是 settings 命名空间；`include:` 前缀由安装方式决定，两种都认。 */
    const NAMESPACE_IDS = ['include:subagent-devin', 'subagent-devin'];

    const EN = {
      title: 'Devin subagent',
      intro: 'Hand a task to Devin and get its answer back in this session.',
      connection: 'Connection',
      idle: 'Not connected',
      busy: 'Checking',
      live: 'Connected',
      notDetected: 'No Devin sign-in found on this machine yet.',
      checking: 'Checking the local Devin sign-in and key…',
      wayOne: 'Option 1 · sign in with your Devin account',
      wayTwo: 'Option 2 · paste a key',
      copy: 'Copy',
      copied: 'Copied — full local path included',
      copiedShort: 'Copied',
      copyFailed: 'The browser refused clipboard access. Copy it manually.',
      copyFailedShort: 'Failed',
      wayOneHint: 'Run it in a terminal. The path is long, so use Copy instead of retyping. The browser opens a sign-in page; then press "Check again".',
      wayTwoPlaceholder: 'Paste the key that starts with devin-',
      save: 'Save',
      saveFailed: 'Saving the key failed.',
      keyNote: 'The key goes into the system credential store only. It is never shown again and never written to configuration.',
      keyNotePlatform: 'A key starting with apk_user_ is a platform API key and does not work here.',
      whereIsIt: 'Cannot find the key?',
      reveal: 'Open credential file location',
      revealHint: 'The file manager opens at credentials.toml.',
      revealRequested: 'Requested. If nothing opened, the system may have blocked it.',
      recheck: 'Check again',
      rechecking: 'Checking…',
      never: 'never',
      lastCheck: 'last checked',
      models: 'Models',
      model: 'Model',
      followDefault: 'Account default',
      modelsLocked: 'Sign in or paste a key to list the models this account can use.',
      modelsBusy: 'The list appears once the check finishes.',
      modelsHint: 'The list comes from the last check; a misspelled name is silently replaced by Devin.',
      behaviour: 'How it runs',
      permission: 'Subagent permissions',
      allow: 'May edit files',
      reject: 'Read-only',
      permissionWarn: 'With "May edit files", changes happen without an approval prompt.',
      permissionSafe: 'With "Read-only", Devin write requests are refused.',
      keyLabel: 'Key',
      keySaved: 'Saved',
      keyFromCli: 'from the local Devin sign-in',
      keyFromStore: 'saved in the credential store',
      replaceKey: 'Replace key',
      loosePermissions: 'That credential file is readable by other accounts on this machine; chmod 600 tightens it.',
      accountUnknown: 'Signed in',
      modelsCountSuffix: ' models available',
      unavailable: 'This page cannot reach the application right now.',
      noNamespace: 'This page could not find the plugin row that stores its settings, so it cannot show or change them. Reinstall the plugin, or restart the application after installing it.',
      readFailed: 'Could not read the current settings.',
      writeFailed: 'Saving failed.',
      rawDiag: 'Technical detail',
      // 原因码：Host 只给码，句子在这里；键名按 'reason-<码>' 拍平，便于 locale.bind 翻译。
        'reason-cli-not-logged-in': 'The local Devin CLI is not signed in and no key is saved. Run the command above in a terminal, or paste a key.',
        'reason-cli-no-key': 'No key was found in the local Devin credential file. Run the command above, or paste a key.',
        'reason-cli-not-runnable': 'No usable Devin command line was found. Check the plugin setting for its path.',
        'reason-handshake-failed': 'The Devin command line did not answer. Try again in a moment.',
        'reason-auth-failed': 'The key was not accepted. Use the one that starts with devin-; an apk_user_ key is a platform API key and cannot sign a subagent in.',
        'reason-import-disabled': 'Automatic import is turned off. Paste a key instead.',
        'reason-import-failed': 'Importing from the local credential file failed. Paste a key, or check the application log.',
        'reason-credential-empty': 'The credential store has an entry but no readable value. Save the key again.',
        'reason-no-credential-service': 'The application credential service is unavailable, so the key cannot be read or saved.',
        'reason-no-credential-location': 'No credential file exists yet; it appears after Devin has signed in once.',
        'reason-platform-key-unusable': 'The saved key is a platform API key (apk_user_), which a subagent cannot use. Sign in locally or paste a key that starts with devin-.',
    };

    const ZH = {
      title: 'Devin 子代理',
      intro: '把一个任务交给 Devin 执行，结果回到当前会话。',
      connection: '连接',
      idle: '未连接',
      busy: '检测中',
      live: '已连接',
      notDetected: '还没检测到本机 Devin 的登录凭据。',
      checking: '正在检查本机 Devin 的登录状态与密钥…',
      wayOne: '方式一 · 用 Devin 账号登录',
      wayTwo: '方式二 · 直接填写密钥',
      copy: '复制',
      copied: '已复制：含本机完整路径',
      copiedShort: '已复制',
      copyFailed: '浏览器拒绝了剪贴板，请手动复制。',
      copyFailedShort: '复制失败',
      wayOneHint: '在终端运行它。路径很长，建议点「复制」再粘贴，别手打；浏览器会打开登录页，完成后点「重新检测」。',
      wayTwoPlaceholder: '粘贴 devin- 开头的密钥',
      save: '保存',
      saveFailed: '密钥保存失败。',
      keyNote: '密钥只存进系统凭据库，页面不回显，也不写进配置。',
      keyNotePlatform: 'apk_user_ 开头的是平台接口密钥，这里用不了。',
      whereIsIt: '不知道密钥在哪？',
      reveal: '打开凭据文件位置',
      revealHint: '文件管理器会定位到 credentials.toml。',
      revealRequested: '已请求打开；如果没有弹出，可能是系统拦住了。',
      recheck: '重新检测',
      rechecking: '检测中…',
      never: '从未',
      lastCheck: '最近检查',
      models: '模型',
      model: '模型',
      followDefault: '跟随账号默认',
      modelsLocked: '登录或填密钥后，可以列出这个账号可用的模型。',
      modelsBusy: '检测完成后可以列出这个账号可用的模型。',
      modelsHint: '列表来自最近一次检查；写错的名字会被 Devin 静默换成默认模型。',
      behaviour: '运行方式',
      permission: '子代理权限',
      allow: '允许改文件',
      reject: '只读',
      permissionWarn: '选「允许改文件」时不会弹审批，请确认知道后果。',
      permissionSafe: '选「只读」时 Devin 的写入请求会被拒绝。',
      keyLabel: '密钥',
      keySaved: '已保存',
      keyFromCli: '来自本机 Devin 登录',
      keyFromStore: '存于系统凭据库',
      replaceKey: '替换密钥',
      loosePermissions: '凭据文件同机其他账号可读，建议 chmod 600 收紧。',
      accountUnknown: '已登录',
      modelsCountSuffix: ' 个可用模型',
      unavailable: '这个界面暂时连不上应用主进程。',
      noNamespace: '这个页面找不到保存它的设置的那一行配置，因此无法显示或修改设置。请重装插件，或在安装后重启应用。',
      readFailed: '读不到当前设置。',
      writeFailed: '保存失败。',
      rawDiag: '技术细节',
      // 原因码：Host 只给码，句子在这里；键名按 'reason-<码>' 拍平，便于 locale.bind 翻译。
        'reason-cli-not-logged-in': '本机 Devin 还没有登录，也没有已保存的密钥。在终端运行上面的命令，或直接粘贴一把密钥。',
        'reason-cli-no-key': '没在本机 Devin 的凭据文件里找到密钥。在终端运行上面的命令，或直接粘贴一把密钥。',
        'reason-cli-not-runnable': '找不到可用的 Devin 命令行，请检查插件设置里的路径。',
        'reason-handshake-failed': 'Devin 命令行没有正常应答，请稍后再试。',
        'reason-auth-failed': '密钥没有被接受。请用 devin- 开头的那把；apk_user_ 开头的是平台接口密钥，不能用来登录子代理。',
        'reason-import-disabled': '自动导入已关闭，请直接粘贴密钥。',
        'reason-import-failed': '从本机凭据文件导入失败。请直接粘贴密钥，或查看应用日志。',
        'reason-credential-empty': '凭据库里有这条记录但读不到值，请重新保存一次密钥。',
        'reason-no-credential-service': '应用的凭据服务不可用，暂时无法读写密钥。',
        'reason-no-credential-location': '还没找到凭据文件；Devin 登录过一次之后才会生成。',
        'reason-platform-key-unusable': '存的是平台接口密钥（apk_user_ 开头），子代理用不了。请在本机登录一次，或粘贴 devin- 开头的密钥。',
    };

    /** 样式：只用主题 token，跟随明暗主题。 */
    const CSS = `
.dsv-page{display:flex;flex-direction:column;gap:16px;max-width:720px}
.dsv-head h2{margin:0 0 6px;font-size:20px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsv-head p{margin:0;font-size:13px;color:var(--dsw-alias-label-secondary)}
.dsv-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:16px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:10px}
.dsv-card[data-muted=true]{background:var(--dsw-static-neutral-bluish-60)}
.dsv-cardHead{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dsv-cardTitle{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsv-badge{display:inline-flex;align-items:center;gap:6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);padding:1px 9px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dsv-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}
.dsv-dot[data-state=ok]{background:var(--dsw-alias-state-success-primary)}
.dsv-dot[data-state=idle]{background:var(--dsw-alias-state-warn-primary)}
.dsv-sectionLabel{font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary)}
.dsv-label{font-size:13px;color:var(--dsw-alias-label-secondary)}
.dsv-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsv-row[hidden]{display:none}
.dsv-account{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsv-input{height:34px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 12px;font-size:13px;font-family:inherit;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);min-width:0;flex:1 1 140px;box-sizing:border-box}
.dsv-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsv-input:disabled{background:var(--dsw-static-neutral-bluish-60);color:var(--dsw-alias-label-tertiary)}
.dsv-cmd{display:flex;align-items:flex-start;gap:8px;min-height:40px;padding:8px 6px 8px 12px;border-radius:8px;background:var(--dsw-static-neutral-bluish-60);border:1px solid var(--dsw-alias-border-l2);box-sizing:border-box}
.dsv-cmd code{flex:1;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-all}
.dsv-btn{height:34px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:none;font-family:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}
.dsv-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-tertiary)}
.dsv-btn:disabled{opacity:.45;cursor:default}
.dsv-btn[data-primary=true]{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1);border-color:transparent}
.dsv-btn[data-primary=true]:disabled{background:var(--dsw-static-neutral-bluish-60);color:var(--dsw-alias-label-tertiary);border-color:var(--dsw-alias-border-l2);opacity:1}
.dsv-btn[data-small=true]{height:28px;padding:0 10px;font-size:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.dsv-hint{margin:0;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-tertiary)}
.dsv-warn{margin:0;font-size:12px;line-height:1.55;color:var(--dsw-alias-state-warn-primary)}
.dsv-error{margin:0;font-size:12px;line-height:1.55;color:var(--dsw-alias-state-error-primary)}
.dsv-divider{height:1px;background:var(--dsw-alias-border-l1)}
.dsv-link{font-size:12px;color:var(--dsw-alias-label-primary);cursor:pointer;text-decoration:none;border:0;background:none;padding:0;font-family:inherit}
.dsv-link:hover{text-decoration:underline}
.dsv-select{height:34px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 12px;font-size:13px;font-family:inherit;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);width:100%;box-sizing:border-box}
.dsv-select:disabled{background:var(--dsw-static-neutral-bluish-60);color:var(--dsw-alias-label-tertiary)}
.dsv-diag{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary);white-space:pre-wrap;word-break:break-word}
`;

    function remote(ctx, name) {
      try { return ctx.get(`remote.${name}`); } catch { return undefined; }
    }

    /**
     * 找出本插件的 settings 命名空间。
     *
     * 先按确定的 namespace id 找：插件行的 entry id 就是命名空间，`include:` 前缀由
     * 安装方式决定，所以两种都列上。找不到才退回按字段特征找，而且要求那个值确实是
     * 我们的（`credentialRef` 等于本插件的引用名）——profile 里还有别的插件行也带
     * `credentialRef`，只按“有这个字段”认会抓到别人的行。
     */
    function findNamespace(described) {
      const list = described?.namespaces ?? [];
      for (const id of NAMESPACE_IDS) {
        const hit = list.find((entry) => entry.ns === id);
        if (hit !== undefined) return hit;
      }
      return list.find((entry) => entry.value?.credentialRef === CREDENTIAL_REF) ?? null;
    }

    /** 两次读取是否给出了同一份事实；相同就不必重渲染。 */
    function sameSnapshot(current, next) {
      if (current.phase !== next.phase) return false;
      if (current.ns !== next.ns || current.revision !== next.revision) return false;
      return JSON.stringify(current.key) === JSON.stringify(next.key)
        && JSON.stringify(current.settings) === JSON.stringify(next.settings);
    }

    function formatWhen(iso) {
      if (typeof iso !== 'string' || iso === '') return '';
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '';
      const pad = (value) => String(value).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    /** 终端里要跑的命令：没有命令时给一个能让用户自己找的说法。 */
    function terminalCommand(command) {
      const binary = typeof command === 'string' && command !== '' ? `"${command}"` : 'devin';
      return `${binary} auth login`;
    }

    function Page(props) {
      const t = props.t;
      const ctx = props.ctx;
      const [state, setState] = React.useState({ phase: 'loading', key: null, settings: null, ns: '', revision: undefined, error: '' });
      const [draft, setDraft] = React.useState('');
      const [busy, setBusy] = React.useState('');
      const [notice, setNotice] = React.useState('');
      const [replacing, setReplacing] = React.useState(false);
      const [copyState, setCopyState] = React.useState('');
      const probe = state.settings?.probe ?? {};
      const settled = typeof probe.at === 'string' && probe.at !== '';

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
          const next = {
            phase: 'ready',
            key: keyMap?.[CREDENTIAL_REF] ?? null,
            settings: namespace?.value ?? null,
            ns: namespace?.ns ?? '',
            revision: namespace?.revision,
            error: '',
          };
          // 后台刷新：内容没变就返回原对象，React 会跳过重渲染，页面不会闪。
          setState((current) => (sameSnapshot(current, next) ? current : next));
        } catch (error) {
          setState({ phase: 'error', key: null, settings: null, ns: '', revision: undefined, error: error?.message ?? String(error) });
        }
      }, [ctx]);

      React.useEffect(() => { void load(); }, [load]);

      // 探测在本页打开之后才跑完（要起子进程、握手，通常 3~10 秒）。没有这条轮询，
      // 页面会一直停在“打开那一刻”的快照上，看起来像所有设置都没生效。
      // 还没拿到结果时勤一点；拿到之后放慢，只为跟上别处改过的设置。
      React.useEffect(() => {
        if (settled) return undefined;
        const timer = setInterval(() => { void load(); }, 2000);
        return () => clearInterval(timer);
      }, [load, settled]);
      React.useEffect(() => {
        if (!settled) return undefined;
        const timer = setInterval(() => { void load(); }, 15000);
        return () => clearInterval(timer);
      }, [load, settled]);

      const patchSettings = async (patch) => {
        if (state.ns === '') { setNotice(t('readFailed')); return; }
        setBusy('settings');
        setNotice('');
        try {
          await remote(ctx, 'settings').update(state.ns, patch, state.revision);
          await load();
        } catch (error) {
          setNotice(`${t('writeFailed')} ${error?.message ?? ''}`.trim());
        } finally { setBusy(''); }
      };

      const saveKey = async () => {
        const value = draft.trim();
        if (value === '') return;
        setBusy('key');
        setNotice('');
        try {
          await remote(ctx, 'credentials').set(CREDENTIAL_REF, value);
          setDraft('');
          setReplacing(false);
          await load();
          // 保存后立刻请求一次检查，让页面自己走到结果态。
          await patchSettings({ refreshToken: Date.now() });
        } catch (error) {
          setNotice(`${t('saveFailed')} ${error?.message ?? ''}`.trim());
        } finally { setBusy(''); }
      };

      /** 请求 Host 重新检查：写计数 → 插件行重载 → 结果写回配置 → 这里轮询到变化。 */
      const recheck = async () => {
        if (state.ns === '') { setNotice(t('readFailed')); return; }
        setBusy('check');
        setNotice('');
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

      /** 请求 Host 打开凭据文件位置（同样靠计数触发，见文件头说明）。 */
      const reveal = async () => {
        if (state.ns === '') { setNotice(t('readFailed')); return; }
        await patchSettings({ revealToken: Date.now() });
        setNotice(t('revealRequested'));
      };

      const copyCommand = async () => {
        const command = terminalCommand(probe.command);
        try {
          await navigator.clipboard.writeText(command);
          setNotice(t('copied'));
          setCopyState('ok');
        } catch {
          setNotice(t('copyFailed'));
          setCopyState('fail');
        }
        // 就地反馈：提示行在页面底部，不在视野里，按钮自己要说一句。
        setTimeout(() => setCopyState(''), 1500);
      };

      if (state.phase === 'loading') {
        return h(React.Fragment, null, h('style', null, CSS), h('div', { className: 'dsv-page' }, h('p', { className: 'dsv-hint' }, '…')));
      }
      if (state.phase === 'unavailable' || state.phase === 'error') {
        return h(React.Fragment, null,
          h('style', null, CSS),
          h('div', { className: 'dsv-page' },
            h('div', { className: 'dsv-head' }, h('h2', null, t('title'))),
            h('p', { className: 'dsv-error' }, state.phase === 'unavailable' ? t('unavailable') : `${t('readFailed')} ${state.error}`)));
      }

      if (state.phase === 'ready' && state.ns === '') {
        return h(React.Fragment, null,
          h('style', null, CSS),
          h('div', { className: 'dsv-page' },
            h('div', { className: 'dsv-head' }, h('h2', null, t('title'))),
            h('p', { className: 'dsv-error' }, t('noNamespace'))));
      }

      const keyConfigured = state.key?.configured === true;
      const models = Array.isArray(probe.models) ? probe.models : [];
      const checked = typeof probe.at === 'string' && probe.at !== '';
      const connected = keyConfigured && probe.ok === true && probe.authenticated === true;
      const checking = busy === 'check';
      const model = state.settings?.model ?? '';
      const permission = state.settings?.permission ?? 'allow';
      const status = checking ? 'busy' : (connected ? 'live' : 'idle');
      const dotState = checking ? 'busy' : (connected ? 'ok' : 'idle');
      const reasonText = typeof probe.reason === 'string' && probe.reason !== ''
        ? (() => { const text = t(`reason-${probe.reason}`); return text === `reason-${probe.reason}` ? '' : text; })()
        : '';
      const statusText = checking ? t('busy') : (connected ? t('live') : t('idle'));
      const lastCheckText = checking ? t('rechecking') : (checked ? formatWhen(probe.at) : t('never'));
      const keyPrefix = typeof probe.keyPrefix === 'string' && probe.keyPrefix !== '' ? probe.keyPrefix : '';

      // 连接卡下半部分：未配置时给输入框，已配置时收成一行事实加「替换密钥」。
      const keyBlock = keyConfigured && !replacing
        ? [
          h('div', { className: 'dsv-sectionLabel', key: 'label' }, t('keyLabel')),
          h('p', { key: 'value', className: 'dsv-hint', style: { fontSize: '13px', color: 'var(--dsw-alias-label-primary)' } },
            `${t('keySaved')} · ${keyPrefix}…（${probe.source === 'cli' ? t('keyFromCli') : t('keyFromStore')}）`),
          h('button', {
            key: 'replace',
            className: 'dsv-link',
            onClick: () => { setReplacing(true); setNotice(''); },
          }, t('replaceKey')),
          probe.loosePermissions === true ? h('p', { key: 'loose', className: 'dsv-hint' }, t('loosePermissions')) : null,
        ]
        : [
          h('div', { className: 'dsv-sectionLabel', key: 'label' }, t('wayTwo')),
          h('div', { className: 'dsv-row', key: 'row' },
            h('input', {
              className: 'dsv-input',
              type: 'password',
              autoComplete: 'off',
              placeholder: t('wayTwoPlaceholder'),
              value: draft,
              disabled: busy === 'key',
              onChange: (event) => setDraft(event.target.value),
            }),
            h('button', {
              className: 'dsv-btn',
              'data-primary': 'true',
              disabled: busy === 'key' || draft.trim() === '',
              onClick: saveKey,
            }, t('save'))),
          h('p', { key: 'note', className: 'dsv-hint' }, t('keyNote')),
          h('p', { key: 'note2', className: 'dsv-hint' }, t('keyNotePlatform')),
        ];

      return h(React.Fragment, null,
        h('style', null, CSS),
        h('div', { className: 'dsv-page' },
          h('div', { className: 'dsv-head' }, h('h2', null, t('title')), h('p', null, t('intro'))),

          // ---- 连接 ----
          h('section', { className: 'dsv-card', 'data-muted': checking ? 'true' : 'false' },
            h('div', { className: 'dsv-cardHead' },
              h('span', { className: 'dsv-cardTitle' }, t('connection')),
              h('span', { className: 'dsv-badge' },
                h('span', { className: 'dsv-dot', 'data-state': dotState }),
                statusText)),

            connected
              ? h('div', { className: 'dsv-account' }, probe.account !== '' ? probe.account : t('accountUnknown'))
              : h('p', { className: 'dsv-hint', style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' } },
                checking ? t('checking') : t('notDetected')),

            connected
              ? h('p', { className: 'dsv-hint', style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' } },
                `${models.length}${t('modelsCountSuffix')} · ${t('lastCheck')} ${formatWhen(probe.at)}`)
              : null,

            !connected ? h('div', { className: 'dsv-divider' }) : null,

            // 方式一：账号登录。已连接时不再展示——那时候用户已经不需要它了。
            ...(!connected ? [
              h('div', { className: 'dsv-sectionLabel', key: 'wayOneLabel' }, t('wayOne')),
              h('div', { className: 'dsv-cmd', key: 'wayOneCmd' },
                h('code', { style: checking ? { color: 'var(--dsw-alias-label-tertiary)' } : null }, terminalCommand(probe.command)),
                h('button', { className: 'dsv-btn', 'data-small': 'true', onClick: copyCommand, disabled: checking },
                  copyState === 'ok' ? t('copiedShort') : (copyState === 'fail' ? t('copyFailedShort') : t('copy')))),
              h('p', { key: 'wayOneHint', className: 'dsv-hint' }, t('wayOneHint')),
              h('div', { key: 'wayOneDivider', className: 'dsv-divider' }),
            ] : []),

            ...keyBlock,

            connected ? h('div', { className: 'dsv-divider' }) : null,

            !keyConfigured ? h('div', { className: 'dsv-divider' }) : null,
            !keyConfigured ? h('p', { className: 'dsv-hint' }, t('whereIsIt')) : null,
            !keyConfigured
              ? h('div', { className: 'dsv-row' },
                h('button', { className: 'dsv-btn', onClick: reveal, disabled: busy === 'settings' }, t('reveal')))
              : null,
            !keyConfigured ? h('p', { className: 'dsv-hint' }, t('revealHint')) : null,
            // 打开失败要说出来，而且已连接时也要说（那里同样有这个按钮）。
            probe.revealReason !== '' && typeof probe.revealReason === 'string'
              ? (() => {
                const text = t(`reason-${probe.revealReason}`);
                return text === `reason-${probe.revealReason}` ? null : h('p', { className: 'dsv-error' }, text);
              })()
              : null,

            reasonText !== '' ? h('p', { className: 'dsv-error' }, reasonText) : null,

            h('div', { className: 'dsv-row', style: { marginTop: '2px' } },
              h('button', { className: 'dsv-btn', 'data-primary': 'true', onClick: recheck, disabled: checking }, checking ? t('rechecking') : t('recheck')),
              h('span', { className: 'dsv-hint' }, `${t('lastCheck')}：${lastCheckText}`),
              keyConfigured
                ? h('button', { className: 'dsv-btn', onClick: reveal, disabled: busy === 'settings' }, t('reveal'))
                : null),

            probe.error !== '' && typeof probe.error === 'string' ? h('p', { className: 'dsv-diag' }, `${t('rawDiag')}：${probe.error}`) : null),

          // ---- 模型 ----
          h('section', { className: 'dsv-card', 'data-muted': models.length === 0 ? 'true' : 'false' },
            h('div', { className: 'dsv-cardHead' }, h('span', { className: 'dsv-cardTitle' }, t('models'))),
            h('select', {
              className: 'dsv-select',
              value: model,
              disabled: models.length === 0 || busy === 'settings',
              onChange: (event) => { void patchSettings({ model: event.target.value }); },
            },
            h('option', { value: '' }, `${t('followDefault')}${probe.current ? ` · ${probe.current}` : ''}`),
            models.map((entry) => h('option', { key: entry.value, value: entry.value }, entry.name || entry.value))),
            h('p', { className: 'dsv-hint' },
              models.length > 0 ? t('modelsHint') : (checking ? t('modelsBusy') : t('modelsLocked')))),

          // ---- 运行方式 ----
          h('section', { className: 'dsv-card' },
            h('div', { className: 'dsv-cardHead' }, h('span', { className: 'dsv-cardTitle' }, t('behaviour'))),
            h('div', { className: 'dsv-row', style: { justifyContent: 'space-between' } },
              h('span', { className: 'dsv-label' }, t('permission')),
              h('select', {
                className: 'dsv-select',
                style: { width: '150px' },
                value: permission,
                disabled: busy === 'settings',
                onChange: (event) => { void patchSettings({ permission: event.target.value }); },
              },
              h('option', { value: 'allow' }, t('allow')),
              h('option', { value: 'reject' }, t('reject')))),
            h('p', { className: 'dsv-warn' }, t('permissionWarn')),
            h('p', { className: 'dsv-hint' }, t('permissionSafe'))),

          notice === '' ? null : h('p', { className: 'dsv-hint' }, notice)));
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        let t = (key) => ZH[key] ?? key;
        try {
          if (ctx.locale !== undefined) {
            const disposeEn = ctx.locale.register(LOCALE_NS, 'en', EN);
            const disposeZh = ctx.locale.register(LOCALE_NS, 'zh', ZH);
            const bound = ctx.locale.bind(LOCALE_NS);
            t = (key) => {
              const translated = bound(key);
              return translated === key ? (ZH[key] ?? key) : translated;
            };
            ctx.effect(() => () => { disposeEn(); disposeZh(); });
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
