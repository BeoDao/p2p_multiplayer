/**
 * UI 문자열. 기본 영어. 지원 언어: en, ja, ru, zh, ar (한국어는 등급 심사 문제로 제공하지 않음 — Chrome 번역에 맡김).
 * 선택: 메뉴/설정의 언어 버튼, `?lang=xx`, 저장값(localStorage), 브라우저 언어 순.
 * 새 언어 추가: STRINGS 에 항목 추가 + LANGS 목록. 직업/아이템 이름은 data/*.json 의 label(영어) 과 labels.{lang}.
 */
export type Lang = 'en' | 'ja' | 'ru' | 'zh' | 'ar';
export const LANGS: { id: Lang; name: string }[] = [
  { id: 'en', name: 'English' }, { id: 'ja', name: '日本語' }, { id: 'ru', name: 'Русский' }, { id: 'zh', name: '中文' }, { id: 'ar', name: 'العربية' },
];

const STRINGS: Record<Lang, Record<string, string>> = {
  en: {
    subtitle: 'Hostless P2P · Deterministic lockstep · 2D skeletal',
    name: 'Name', namePlaceholder: 'Player name',
    room: 'Room code (players entering the same code get connected)',
    join: 'Join / Create online', offline: 'Practice offline', language: 'Language',
    help1: 'Move {A}{D} · Jump {W}/{Space} · Ladder/down {W}{S}',
    help2: 'LMB: attack/dig/build · RMB: shield (knight) · {1}~{9}/wheel: item · {F1}~{F3} change class in base',
    help3: '{E} buy at workshop (gold) · heal at workshop · {Tab} scoreboard · {Enter} chat · {Esc} settings',
    help4: 'Bring the enemy flag to your own flag to score (3 points win)',
    chatPlaceholder: 'Type a message, Enter to send (Esc cancel)',
    settings: 'Settings', volume: 'SFX volume', zoom: 'Screen scale', closeHint: 'Esc to close',
    phase_discover: 'Looking for session', phase_joining: 'Joining', phase_playing: 'Playing', phase_resync: 'Resyncing',
    players: 'players', coordinator: 'coordinator', waiting: 'waiting', resyncs: 'resyncs',
    blue: 'Blue', red: 'Red', nameCol: 'Name', classCol: 'Class', round: 'Round', tick: 'tick',
    carryingFlag: '🚩 Carrying the flag!', teamWins: '{team} team wins!', newRound: 'New round shortly',
    dead: 'Dead', respawnIn: 'Respawn in {s}s', baseHint: 'Base: {F1} Knight · {F2} Archer · {F3} Builder',
    offlineMode: 'Offline mode', roomShare: 'Room {room} — share this link: {url}',
    founder: 'Room created (first player)', joinReq: 'Requesting to join...', admitted: 'Admitted (pid {pid}), waiting for snapshot...',
    synced: 'Synced (tick {tick})', left: '{name} left', waitingFor: 'Waiting ({s}s)...', desyncDetected: 'Desync detected → resyncing',
    flagTaken: '🚩 {name} took the flag!', died: '{name} died', unknownCmd: 'Unknown command: {cmd}',
    connTitle: 'Connecting', connRoom: 'Room code', connDiscover: 'Looking for players in this room', connDiscoverHint: 'If nobody is here within {s}s, you will host the match and others can join anytime.', connJoining: 'Joining the match', connJoiningHint: 'Receiving the world from another player…', connResync: 'Resynchronizing', connRelays: 'Signaling relays', connPeers: 'Peers found', connShare: 'Share this link with friends', copy: 'Copy', copied: 'Copied!', connOffline: 'Starting offline practice',
  },
  ja: {
    subtitle: 'ホスト不要のP2P · 決定論的ロックステップ · 2Dスケルタル',
    name: '名前', namePlaceholder: 'プレイヤー名',
    room: 'ルームコード（同じコードを入力した人同士が接続されます）',
    join: 'オンラインで参加 / 作成', offline: 'オフライン練習', language: '言語',
    help1: '移動 {A}{D} · ジャンプ {W}/{Space} · はしご/下 {W}{S}',
    help2: '左クリック: 攻撃/採掘/建築 · 右クリック: 盾（騎士） · {1}~{9}/ホイール: アイテム · 拠点で {F1}~{F3} クラス変更',
    help3: '作業場で {E} 購入（金） · 作業場で回復 · {Tab} スコア · {Enter} チャット · {Esc} 設定',
    help4: '敵の旗を自軍の旗まで運ぶと得点（3点で勝利）',
    chatPlaceholder: 'メッセージを入力して Enter（Esc でキャンセル）',
    settings: '設定', volume: '効果音の音量', zoom: '画面倍率', closeHint: 'Esc で閉じる',
    phase_discover: 'セッションを検索中', phase_joining: '参加中', phase_playing: 'プレイ中', phase_resync: '再同期中',
    players: '人', coordinator: 'コーディネーター', waiting: '待機中', resyncs: '回再同期',
    blue: '青', red: '赤', nameCol: '名前', classCol: 'クラス', round: 'ラウンド', tick: 'ティック',
    carryingFlag: '🚩 旗を運搬中！', teamWins: '{team}チームの勝利！', newRound: 'まもなく新ラウンド',
    dead: '死亡', respawnIn: '{s}秒後に復活', baseHint: '拠点: {F1} 騎士 · {F2} 弓兵 · {F3} 建築家',
    offlineMode: 'オフラインモード', roomShare: 'ルーム {room} — このリンクを共有: {url}',
    founder: 'ルームを作成しました（最初のプレイヤー）', joinReq: '参加をリクエスト中...', admitted: '承認されました (pid {pid})、スナップショット待ち...',
    synced: '同期完了（ティック {tick}）', left: '{name} が退出しました', waitingFor: '待機中（{s}秒）...', desyncDetected: '同期ずれを検出 → 再同期',
    flagTaken: '🚩 {name} が旗を取った！', died: '{name} が死亡', unknownCmd: '不明なコマンド: {cmd}',
    connTitle: '接続中', connRoom: 'ルームコード', connDiscover: 'このルームのプレイヤーを探しています', connDiscoverHint: '{s}秒以内に誰もいなければ、あなたがホストとなり、他の人はいつでも参加できます。', connJoining: '試合に参加中', connJoiningHint: '他のプレイヤーからワールドを受信しています…', connResync: '再同期中', connRelays: 'シグナリングリレー', connPeers: '見つかったピア', connShare: 'このリンクを友達に共有', copy: 'コピー', copied: 'コピーしました', connOffline: 'オフライン練習を開始',
  },
  ru: {
    subtitle: 'P2P без хоста · Детерминированный lockstep · 2D скелетная анимация',
    name: 'Имя', namePlaceholder: 'Имя игрока',
    room: 'Код комнаты (игроки с одинаковым кодом соединяются)',
    join: 'Играть онлайн / создать', offline: 'Тренировка офлайн', language: 'Язык',
    help1: 'Движение {A}{D} · Прыжок {W}/{Space} · Лестница/вниз {W}{S}',
    help2: 'ЛКМ: атака/копать/строить · ПКМ: щит (рыцарь) · {1}~{9}/колесо: предмет · {F1}~{F3} смена класса на базе',
    help3: '{E} купить в мастерской (золото) · лечение в мастерской · {Tab} таблица · {Enter} чат · {Esc} настройки',
    help4: 'Принесите вражеский флаг к своему, чтобы забить (3 очка — победа)',
    chatPlaceholder: 'Введите сообщение, Enter — отправить (Esc — отмена)',
    settings: 'Настройки', volume: 'Громкость звуков', zoom: 'Масштаб экрана', closeHint: 'Esc — закрыть',
    phase_discover: 'Поиск сессии', phase_joining: 'Подключение', phase_playing: 'Игра', phase_resync: 'Ресинхронизация',
    players: 'игроков', coordinator: 'координатор', waiting: 'ожидание', resyncs: 'ресинхр.',
    blue: 'Синие', red: 'Красные', nameCol: 'Имя', classCol: 'Класс', round: 'Раунд', tick: 'тик',
    carryingFlag: '🚩 Вы несёте флаг!', teamWins: 'Команда {team} победила!', newRound: 'Скоро новый раунд',
    dead: 'Погиб', respawnIn: 'Возрождение через {s} с', baseHint: 'База: {F1} Рыцарь · {F2} Лучник · {F3} Строитель',
    offlineMode: 'Офлайн-режим', roomShare: 'Комната {room} — поделитесь ссылкой: {url}',
    founder: 'Комната создана (первый игрок)', joinReq: 'Запрос на подключение...', admitted: 'Принят (pid {pid}), ожидание снимка...',
    synced: 'Синхронизировано (тик {tick})', left: '{name} вышел', waitingFor: 'Ожидание ({s} с)...', desyncDetected: 'Рассинхрон → ресинхронизация',
    flagTaken: '🚩 {name} взял флаг!', died: '{name} погиб', unknownCmd: 'Неизвестная команда: {cmd}',
    connTitle: 'Подключение', connRoom: 'Код комнаты', connDiscover: 'Ищем игроков в этой комнате', connDiscoverHint: 'Если за {s} с никто не найдётся, вы станете хостом, а другие смогут присоединиться в любой момент.', connJoining: 'Подключение к матчу', connJoiningHint: 'Получаем мир от другого игрока…', connResync: 'Ресинхронизация', connRelays: 'Сигнальные релеи', connPeers: 'Найдено пиров', connShare: 'Поделитесь ссылкой с друзьями', copy: 'Копировать', copied: 'Скопировано!', connOffline: 'Запуск офлайн-тренировки',
  },
  zh: {
    subtitle: '无主机 P2P · 确定性锁步 · 2D 骨骼动画',
    name: '名字', namePlaceholder: '玩家名字',
    room: '房间代码（输入相同代码的玩家会互相连接）',
    join: '在线加入 / 创建', offline: '离线练习', language: '语言',
    help1: '移动 {A}{D} · 跳跃 {W}/{Space} · 梯子/向下 {W}{S}',
    help2: '左键：攻击/挖掘/建造 · 右键：盾牌（骑士） · {1}~{9}/滚轮：物品 · 基地内 {F1}~{F3} 切换职业',
    help3: '工坊上 {E} 购买（金） · 工坊上回血 · {Tab} 记分板 · {Enter} 聊天 · {Esc} 设置',
    help4: '把敌方旗帜带回己方旗帜处得分（3 分获胜）',
    chatPlaceholder: '输入消息，Enter 发送（Esc 取消）',
    settings: '设置', volume: '音效音量', zoom: '画面缩放', closeHint: '按 Esc 关闭',
    phase_discover: '正在查找会话', phase_joining: '加入中', phase_playing: '游戏中', phase_resync: '重新同步中',
    players: '名玩家', coordinator: '协调者', waiting: '等待中', resyncs: '次重同步',
    blue: '蓝队', red: '红队', nameCol: '名字', classCol: '职业', round: '回合', tick: '刻',
    carryingFlag: '🚩 正在携带旗帜！', teamWins: '{team}获胜！', newRound: '即将开始新回合',
    dead: '阵亡', respawnIn: '{s} 秒后复活', baseHint: '基地：{F1} 骑士 · {F2} 弓手 · {F3} 建造者',
    offlineMode: '离线模式', roomShare: '房间 {room} — 分享此链接：{url}',
    founder: '已创建房间（第一位玩家）', joinReq: '正在请求加入...', admitted: '已批准 (pid {pid})，等待快照...',
    synced: '已同步（刻 {tick}）', left: '{name} 离开了', waitingFor: '等待中（{s} 秒）...', desyncDetected: '检测到失步 → 重新同步',
    flagTaken: '🚩 {name} 夺取了旗帜！', died: '{name} 阵亡', unknownCmd: '未知命令：{cmd}',
    connTitle: '连接中', connRoom: '房间代码', connDiscover: '正在寻找此房间的玩家', connDiscoverHint: '若 {s} 秒内无人，你将成为主机，其他人可随时加入。', connJoining: '正在加入对局', connJoiningHint: '正在从其他玩家接收世界…', connResync: '重新同步中', connRelays: '信令中继', connPeers: '已发现的节点', connShare: '把此链接分享给朋友', copy: '复制', copied: '已复制！', connOffline: '正在开始离线练习',
  },
  ar: {
    subtitle: 'P2P بدون مضيف · مزامنة حتمية · حركة هيكلية ثنائية الأبعاد',
    name: 'الاسم', namePlaceholder: 'اسم اللاعب',
    room: 'رمز الغرفة (يتصل اللاعبون الذين يدخلون نفس الرمز)',
    join: 'انضمام / إنشاء عبر الإنترنت', offline: 'تدريب دون اتصال', language: 'اللغة',
    help1: 'الحركة {A}{D} · القفز {W}/{Space} · السلّم/الأسفل {W}{S}',
    help2: 'زر الفأرة الأيسر: هجوم/حفر/بناء · الأيمن: درع (الفارس) · {1}~{9}/العجلة: الأداة · {F1}~{F3} تغيير الفئة في القاعدة',
    help3: '{E} شراء في الورشة (ذهب) · الشفاء في الورشة · {Tab} لوحة النتائج · {Enter} دردشة · {Esc} الإعدادات',
    help4: 'أحضر علم العدو إلى علمك لتسجيل نقطة (3 نقاط للفوز)',
    chatPlaceholder: 'اكتب رسالة ثم Enter للإرسال (Esc للإلغاء)',
    settings: 'الإعدادات', volume: 'مستوى المؤثرات الصوتية', zoom: 'حجم الشاشة', closeHint: 'Esc للإغلاق',
    phase_discover: 'البحث عن جلسة', phase_joining: 'جارٍ الانضمام', phase_playing: 'جارٍ اللعب', phase_resync: 'إعادة المزامنة',
    players: 'لاعبين', coordinator: 'المنسّق', waiting: 'انتظار', resyncs: 'إعادة مزامنة',
    blue: 'الأزرق', red: 'الأحمر', nameCol: 'الاسم', classCol: 'الفئة', round: 'الجولة', tick: 'نبضة',
    carryingFlag: '🚩 تحمل العلم!', teamWins: 'فاز الفريق {team}!', newRound: 'جولة جديدة قريبًا',
    dead: 'مات', respawnIn: 'العودة بعد {s} ث', baseHint: 'القاعدة: {F1} فارس · {F2} رامٍ · {F3} بنّاء',
    offlineMode: 'وضع دون اتصال', roomShare: 'الغرفة {room} — شارك هذا الرابط: {url}',
    founder: 'تم إنشاء الغرفة (أول لاعب)', joinReq: 'جارٍ طلب الانضمام...', admitted: 'تم القبول (pid {pid})، بانتظار اللقطة...',
    synced: 'تمت المزامنة (نبضة {tick})', left: 'غادر {name}', waitingFor: 'انتظار ({s} ث)...', desyncDetected: 'اكتُشف عدم تزامن → إعادة المزامنة',
    flagTaken: '🚩 أخذ {name} العلم!', died: 'مات {name}', unknownCmd: 'أمر غير معروف: {cmd}',
    connTitle: 'جارٍ الاتصال', connRoom: 'رمز الغرفة', connDiscover: 'نبحث عن لاعبين في هذه الغرفة', connDiscoverHint: 'إذا لم يوجد أحد خلال {s} ث، ستستضيف المباراة ويمكن للآخرين الانضمام في أي وقت.', connJoining: 'الانضمام إلى المباراة', connJoiningHint: 'جارٍ استلام العالم من لاعب آخر…', connResync: 'إعادة المزامنة', connRelays: 'مرحّلات الإشارة', connPeers: 'الأقران الموجودون', connShare: 'شارك هذا الرابط مع أصدقائك', copy: 'نسخ', copied: 'تم النسخ!', connOffline: 'بدء التدريب دون اتصال',
  },
};

export let LANG: Lang = 'en';
const isLang = (v: string | null): v is Lang => v === 'en' || v === 'ja' || v === 'ru' || v === 'zh' || v === 'ar';

export function detectLang(): Lang {
  const q = new URLSearchParams(location.search).get('lang');
  if (isLang(q)) return q;
  let saved: string | null = null;
  try { saved = localStorage.getItem('kag2.lang'); } catch { /* ignore */ }
  if (isLang(saved)) return saved;
  const nav = (navigator.language ?? 'en').toLowerCase().slice(0, 2);
  return isLang(nav) ? nav : 'en';
}
export function setLang(l: Lang): void {
  LANG = l;
  document.documentElement.lang = l;
  // 아랍어: 텍스트 방향만 RTL (HUD 배치는 절대 좌표라 유지)
  document.documentElement.style.setProperty('--dir', l === 'ar' ? 'rtl' : 'ltr');
  try { localStorage.setItem('kag2.lang', l); } catch { /* ignore */ }
}

/** 문자열 조회 + {key} 치환. {A} 같은 키 이름은 <kbd> 로 감싸 번역 대상에서 제외. */
export function t(key: string, vars: Record<string, string | number> = {}): string {
  let s = STRINGS[LANG][key] ?? STRINGS.en[key] ?? key;
  s = s.replace(/\{(\w+)\}/g, (_, k: string) => {
    if (k in vars) return String(vars[k]);
    return `<kbd translate="no">${k}</kbd>`;
  });
  return s;
}

/** 직업/아이템 이름: JSON 의 labels[LANG], 없으면 label(영어) */
export function dataLabel(obj: { label: string; labels?: Record<string, string> }): string {
  return obj.labels?.[LANG] ?? obj.label;
}

/** 언어 선택 버튼 HTML */
export function langButtonsHtml(): string {
  return LANGS.map((l) => `<button data-lang="${l.id}" class="${LANG === l.id ? 'on' : ''}" translate="no">${l.name}</button>`).join('');
}
