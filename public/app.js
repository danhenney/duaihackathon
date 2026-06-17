const state = {
  people: [],
  assets: {},
  calls: [],
  selectedCall: null,
  rankWindow: "24h",
  assetWindow: "all",
  currentAsset: null,
  chartData: {},
  chartLoading: {},
  session: null,
  following: [],
  notifyNewIdeas: true,
  notifyReturns: true,
  notifyWeekly: false
};

const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => [...document.querySelectorAll(selector)];

const formatters = {
  USD: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }),
  KRW: new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }),
  EUR: new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }),
  SEK: new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 2 }),
  number: new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 })
};

function price(value, currency = "USD") {
  if (value == null || Number.isNaN(Number(value))) return "-";
  if (currency === "GBp") return `${formatters.number.format(value)}p`;
  if (currency === "index" || currency === "basket") return formatters.number.format(value);
  return (formatters[currency] || formatters.USD).format(value);
}

function pct(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${Number(value).toFixed(Math.abs(value) > 1000 ? 0 : 2)}%`;
}

function pnlClass(value) {
  return (value || 0) >= 0 ? "gain" : "loss";
}

function pctTag(value, className = "") {
  return `<span class="${[pnlClass(value), className].filter(Boolean).join(" ")}">${pct(value)}</span>`;
}

function isScoredCall(call) {
  return ["seed_verified", "ai_detected"].includes(call?.status);
}

function returnLabel(call) {
  return isScoredCall(call) && call.returnPct != null ? `의견 이후 ${pct(call.returnPct)}` : "검증 전";
}

function returnClass(call) {
  return isScoredCall(call) && call.returnPct != null ? pnlClass(call.returnPct) : "pending";
}

function loadLocalState() {
  try {
    const saved = JSON.parse(localStorage.getItem("receiptsUser") || "{}");
    state.session = saved.session || null;
    state.following = Array.isArray(saved.following) ? saved.following : [];
    state.notifyNewIdeas = saved.notifyNewIdeas ?? true;
    state.notifyReturns = saved.notifyReturns ?? true;
    state.notifyWeekly = saved.notifyWeekly ?? false;
  } catch {
    state.session = null;
    state.following = [];
  }
}

function saveLocalState() {
  localStorage.setItem("receiptsUser", JSON.stringify({
    session: state.session,
    following: state.following,
    notifyNewIdeas: state.notifyNewIdeas,
    notifyReturns: state.notifyReturns,
    notifyWeekly: state.notifyWeekly
  }));
}

function isFollowing(personId) {
  return state.following.includes(personId);
}

function toggleFollow(personId) {
  if (!personId) return;
  if (!state.session) {
    switchTab("me");
    renderFollowing();
    return;
  }
  state.following = isFollowing(personId)
    ? state.following.filter((id) => id !== personId)
    : [...state.following, personId];
  saveLocalState();
  renderFollowing();
}

function assetName(symbol) {
  return state.assets[symbol]?.name || symbol;
}

function assetAliases(symbol) {
  const aliases = {
    "000660.KS": ["하이닉스", "sk하이닉스", "sk hynix", "hynix"],
    "005930.KS": ["삼성전자", "삼전", "samsung"],
    "035420.KS": ["네이버", "naver"],
    "035720.KS": ["카카오", "kakao"],
    "005380.KS": ["현대차", "hyundai"],
    "066570.KS": ["lg전자", "엘지전자", "lg electronics", "lge"],
    BTC: ["비트코인", "bitcoin"],
    ETH: ["이더리움", "ethereum"],
    NVDA: ["엔비디아", "nvidia"],
    TSLA: ["테슬라", "tesla"]
  };
  return aliases[symbol] || [];
}

function matchesAsset(symbol, query) {
  const lower = query.toLowerCase();
  return (
    lower.includes(symbol.toLowerCase()) ||
    lower.includes(assetName(symbol).toLowerCase()) ||
    assetAliases(symbol).some((alias) => lower.includes(alias.toLowerCase()))
  );
}

function displayAsset(symbol) {
  return symbol.endsWith(".KS") ? assetName(symbol) : symbol;
}

function categoryKo(category) {
  const map = {
    "AI/Semi Supply Chain": "AI/반도체 공급망",
    "Thematic Research": "테마 리서치",
    "Crypto Macro": "크립토 매크로",
    "Market Strategist": "시장 전략가",
    "Celebrity Investor": "연예인 투자자",
    "AI/Semi Commentary": "AI/반도체 코멘터리",
    "Crypto Media": "크립토 미디어",
    "Crypto Trader": "크립토 트레이더",
    "Bitcoin Executive": "비트코인 경영자",
    "TV Host": "방송 진행자"
  };
  return map[category] || category;
}

function bioKo(person) {
  const map = {
    serenity: "AI 인프라와 반도체 공급망에서 덜 알려진 종목을 발굴하는 X 리서처입니다.",
    citrini: "AI, 매크로, 테마주를 엮어 바이럴되는 투자 리서치를 공개합니다.",
    arthur_hayes: "크립토 시장과 매크로를 긴 에세이와 공개 발언으로 풀어내는 투자자입니다.",
    tom_lee: "주식과 크립토 시장에 대한 공개적인 강세 전망으로 알려진 Fundstrat 전략가입니다.",
    jeon_wonju: "SK하이닉스 장기 보유 사례로 알려진 한국 연예인 투자자입니다.",
    jim_cramer: "CNBC에서 주식 의견을 공개적으로 제시하는 미국 방송 진행자입니다.",
    michael_saylor: "비트코인 장기 보유와 공개 매수 발언으로 알려진 경영자입니다."
  };
  return map[person.id] || person.bio || "";
}

function quoteKo(call) {
  const map = {
    call_serenity_rpi: "Raspberry Pi를 긍정 의견으로 제시했습니다.",
    call_serenity_core_longs: "유럽 반도체 관련 핵심 긍정 종목들을 공개했습니다.",
    call_citrini_citrindex: "Citrini의 핵심 테마 포트폴리오 성과를 공개했습니다.",
    call_citrini_ai_infra: "AI 인프라와 반도체, 에너지 섹터를 긍정적으로 언급했습니다.",
    call_hayes_btc_1m: "비트코인이 2028년까지 100만 달러에 갈 수 있다는 전망을 반복했습니다.",
    call_hayes_holy_trinity: "HYPE, ZEC, NEAR를 핵심 보유 포지션으로 언급했습니다.",
    call_tom_lee_crypto_spring: "BTC와 ETH에 대해 크립토 봄이 왔다고 표현했습니다.",
    call_tom_lee_spx: "S&P 500이 2026년 말 7,700에 도달할 수 있다고 전망했습니다.",
    call_jeon_hynix_2011: "SK하이닉스를 2011년 초 2만원대에 매입해 장기 보유했다고 밝혔습니다.",
    call_jeon_hynix_2021: "방송에서 SK하이닉스를 10년 이상 보유 중이라고 밝혔습니다.",
    call_threadguy_worldcoin: "Worldcoin이 최고의 성과 토큰이 될 수도 있었다는 관점을 언급했습니다.",
    call_saylor_btc: "MicroStrategy의 추가 비트코인 매수를 공개했습니다.",
    verified_serenity_rpi_2026_02_16: "Fun Trade Idea: Long $RPI (Raspberry Pi). Reason: Openclaw / Picoclaw / Nanobot + Hoarding.",
    verified_serenity_rpi_reuters_2026_04_20: "Glad my $RPI x OpenClaw thesis made it to Reuters.",
    verified_citrini_citrindex_2023_05_31: "Citrindex tracks Citrini Research's core thematic model portfolio.",
    verified_citrini_semis_nvda_2026_05_16: "Large Language Models run on GPUs, buy Nvidia.",
    verified_citrini_semis_hynix_2026_05_16: "Every iota of AI compute demand ... memory OEMs, buy Micron and SK Hynix.",
    verified_citrini_data_center_infra_2026_05_22: "AI compute demand would go beyond lifting just Nvidia.",
    verified_hayes_btc_1m_2025_05_01: "Arthur Hayes repeated his prediction that Bitcoin could reach $1 million by 2028.",
    verified_hayes_hype_2026_05_24: "$HYPE, $ZEC, $NEAR the holy trinity!",
    verified_hayes_zec_2026_05_24: "$HYPE, $ZEC, $NEAR the holy trinity!",
    verified_hayes_near_2026_05_24: "$HYPE, $ZEC, $NEAR the holy trinity!",
    verified_tom_lee_crypto_spring_btc_2026_05_05: "$BTC $ETH Crypto spring is here.",
    verified_tom_lee_crypto_spring_eth_2026_05_05: "$BTC $ETH Crypto spring is here.",
    verified_tom_lee_spx_7700_2025_12_11: "Tom Lee expects the S&P 500 to reach 7,700 by end-2026.",
    verified_jeon_hynix_2011: "전원주는 SK하이닉스를 2011년 초 2만원대에 매입해 현재까지 보유 중이라고 밝혔습니다.",
    verified_jeon_hynix_2021_show: "2021년 방송에서 SK하이닉스를 10년 이상 보유 중인 장기 투자자로 소개됐습니다.",
    verified_threadguy_wld_2026_02_10: "There's a parallel universe where worldcoin was the best performing token ever.",
    verified_ansem_hype_fair_value_2024_12_11: "No bias but fair value for $HYPE is around 500B from the exchange alone.",
    verified_ansem_hype_l1_2025_06_03: "Hyperliquid update #4: core business is enshrined within the L1.",
    verified_saylor_btc_2024_02_26: "MicroStrategy acquired an additional 3,000 BTC at an average price of $51,813 per bitcoin.",
    verified_jim_cramer_tsla_buy_2026_05: "Jim Cramer: Tesla is a buy after hearing what Elon Musk said on the earnings call.",
    verified_jukan_hbm4_samsung_hynix_2026_03: "NVIDIA's Vera Rubin to use only Samsung and SK Hynix HBM4.",
    verified_jukan_hbm4_hynix_2026_03: "NVIDIA's Vera Rubin to use only Samsung and SK Hynix HBM4.",
    verified_jukan_hynix_samples_2026_03: "Final HBM4 samples to be delivered to NVIDIA; SK Hynix is set to supply final HBM4 samples."
  };
  return map[call.id] || call.quote;
}

function reasonKo(call) {
  const map = {
    verified_serenity_rpi_2026_02_16: "Raspberry Pi 수요가 AI 에이전트 하드웨어와 저가 장비 hoarding으로 커질 수 있다는 thesis를 제시했습니다.",
    verified_serenity_rpi_reuters_2026_04_20: "기존 RPI/OpenClaw thesis가 언론 보도까지 확산됐다고 언급하며 수요 thesis를 재확인했습니다.",
    verified_citrini_citrindex_2023_05_31: "Citrini가 공개한 thematic model portfolio 자체를 추적 대상으로 삼은 기록입니다.",
    verified_citrini_semis_nvda_2026_05_16: "AI 인프라 1차 수혜를 GPU로 보고 Nvidia를 기본 노출로 직접 언급했습니다.",
    verified_citrini_semis_hynix_2026_05_16: "AI compute 수요가 메모리 OEM까지 흘러간다는 관점에서 SK하이닉스를 직접 언급했습니다.",
    verified_citrini_data_center_infra_2026_05_22: "AI compute 수요가 Nvidia 하나를 넘어 데이터센터 인프라 전반으로 확산된다는 관점을 제시했습니다.",
    verified_hayes_btc_1m_2025_05_01: "달러 유동성 확대와 거시 환경을 근거로 2028년까지 BTC 100만 달러 가능성을 반복 제시했습니다.",
    verified_hayes_hype_2026_05_24: "HYPE를 ZEC, NEAR와 함께 자신의 핵심 보유 포지션으로 강하게 표현했습니다.",
    verified_hayes_zec_2026_05_24: "ZEC를 HYPE, NEAR와 함께 보유 포지션으로 묶어 상승을 기대하는 표현을 남겼습니다.",
    verified_hayes_near_2026_05_24: "NEAR를 HYPE, ZEC와 함께 핵심 보유 코인으로 언급했습니다.",
    verified_tom_lee_crypto_spring_btc_2026_05_05: "BTC와 ETH를 함께 지목하며 크립토 상승 국면이 왔다고 표현했습니다.",
    verified_tom_lee_crypto_spring_eth_2026_05_05: "ETH를 BTC와 함께 크립토 봄의 대표 자산으로 언급했습니다.",
    verified_tom_lee_spx_7700_2025_12_11: "AI/기술주, 완화적 Fed, wall of worry를 근거로 S&P 500 7,700 전망을 제시했습니다.",
    verified_jeon_hynix_2011: "방송/기사에서 2011년 초 2만원대 매수 후 장기 보유 사실이 재조명됐습니다.",
    verified_jeon_hynix_2021_show: "방송 시점에도 SK하이닉스 장기 보유가 확인되어 보유 의견의 지속성을 보여줍니다.",
    verified_threadguy_wld_2026_02_10: "Worldcoin이 최고의 성과 토큰이 될 수도 있었다는 식으로 WLD upside narrative를 언급했습니다.",
    verified_ansem_hype_fair_value_2024_12_11: "Hyperliquid의 거래소 가치만으로도 HYPE fair value가 훨씬 높을 수 있다고 주장했습니다.",
    verified_ansem_hype_l1_2025_06_03: "Hyperliquid는 거래소 핵심 사업이 L1 안에 내재되어 있어 다른 L1 대비 가치 포착이 좋다고 설명했습니다.",
    verified_saylor_btc_2024_02_26: "Strategy의 추가 BTC 매수를 공개하며 기업 차원의 장기 비트코인 축적을 이어갔습니다.",
    verified_jim_cramer_tsla_buy_2026_05: "머스크의 earnings call 발언을 들은 뒤 Tesla를 buy라고 평가한 CNBC 클립입니다.",
    verified_jukan_hbm4_samsung_hynix_2026_03: "NVIDIA 차세대 AI 가속기에 삼성전자와 SK하이닉스 HBM4가 들어간다는 공급망 수혜를 언급했습니다.",
    verified_jukan_hbm4_hynix_2026_03: "SK하이닉스가 NVIDIA Rubin HBM4 공급망에 포함된다는 점을 긍정적인 이벤트로 포착했습니다.",
    verified_jukan_hynix_samples_2026_03: "SK하이닉스의 NVIDIA HBM4 최종 샘플 공급 가능성을 긍정적인 공급망 이벤트로 봤습니다."
  };
  return map[call.id] || null;
}

function positiveReason(call) {
  const text = quoteKo(call);
  const mappedReason = reasonKo(call);
  if (mappedReason) return mappedReason;
  if (call.reason) return call.reason;
  if (call.symbol === "000660.KS") return "HBM과 메모리 업사이클 수혜를 긍정적으로 본 발언입니다.";
  if (call.symbol === "005930.KS") return "메모리 회복과 AI 반도체 사이클을 긍정적으로 본 발언입니다.";
  if (call.symbol === "BTC") return "유동성 확대와 디지털 자산 장기 상승을 긍정적으로 본 발언입니다.";
  if (call.symbol === "ETH") return "크립토 베타 회복과 생태계 수요를 긍정적으로 본 발언입니다.";
  if (call.symbol === "NVDA") return "AI 인프라 수요와 반도체 주도권을 긍정적으로 본 발언입니다.";
  if (call.symbol === "RPI") return "엣지 하드웨어와 AI 공급망 수요를 긍정적으로 본 발언입니다.";
  if (call.symbol === "HYPE") return "온체인 거래소 성장성을 긍정적으로 본 발언입니다.";
  if (call.symbol === "ZEC") return "프라이버시 코인 재평가 가능성을 긍정적으로 본 발언입니다.";
  if (call.symbol === "NEAR") return "AI/체인 추상화 테마를 긍정적으로 본 발언입니다.";
  if (call.symbol === "TSLA") return "AI, 로보틱스, 머스크 발언 이후 반등 가능성을 긍정적으로 본 발언입니다.";
  if (call.symbol === "SPX") return "미국 증시와 위험자산 흐름을 긍정적으로 본 발언입니다.";
  return text;
}

function statusKo(status) {
  const map = {
    seed_verified: "원문 확인",
    seed_candidate: "검토 제외",
    live_candidate: "방금 찾음",
    ai_detected: "AI 확인"
  };
  return map[status] || status;
}

function assetLogo(symbol) {
  return displayAsset(symbol).slice(0, 2).toUpperCase();
}

function tradingViewSymbol(symbol) {
  const map = {
    BTC: "BINANCE:BTCUSDT",
    ETH: "BINANCE:ETHUSDT",
    HYPE: "KUCOIN:HYPEUSDT",
    ZEC: "BINANCE:ZECUSDT",
    NEAR: "BINANCE:NEARUSDT",
    APT: "BINANCE:APTUSDT",
    WLD: "BINANCE:WLDUSDT",
    RPI: "LSE:RPI",
    AXTI: "NASDAQ:AXTI",
    SIVE: "OMXSTO:SIVE",
    XFAB: "EURONEXT:XFAB",
    SPX: "SP:SPX",
    NVDA: "NASDAQ:NVDA",
    TSLA: "NASDAQ:TSLA",
    WBD: "NASDAQ:WBD",
    "005930.KS": "KRX:005930",
    "035420.KS": "KRX:035420",
    "035720.KS": "KRX:035720",
    "005380.KS": "KRX:005380",
    "000660.KS": "KRX:000660"
  };
  return map[symbol] || symbol.replace(".KS", "");
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function tradingViewSrcDoc(symbol) {
  const config = {
    autosize: true,
    symbol: tradingViewSymbol(symbol),
    interval: "D",
    timezone: "Asia/Seoul",
    theme: "dark",
    style: "1",
    locale: "kr",
    enable_publishing: false,
    allow_symbol_change: false,
    hide_side_toolbar: false,
    withdateranges: true,
    save_image: false,
    calendar: false,
    support_host: "https://www.tradingview.com"
  };

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          html, body, .tradingview-widget-container, .tradingview-widget-container__widget {
            width: 100%;
            height: 100%;
            margin: 0;
            background: #11141c;
          }
        </style>
      </head>
      <body>
        <div class="tradingview-widget-container">
          <div class="tradingview-widget-container__widget"></div>
          <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js" async>
            ${JSON.stringify(config)}
          </script>
        </div>
      </body>
    </html>`;
}

function assetIcon(symbol, className = "asset-icon") {
  const asset = state.assets[symbol];
  if (asset?.logoUrl) {
    return `<img class="${className}" src="${asset.logoUrl}" alt="${displayAsset(symbol)}" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'), {className: '${className} fallback', textContent: '${assetLogo(symbol)}'}))">`;
  }
  return `<div class="${className} fallback">${assetLogo(symbol)}</div>`;
}

function avatar(person, className = "avatar-img") {
  if (!person) return `<div class="${className}">?</div>`;
  if (person.avatarUrl) {
    return `<img class="${className}" src="${person.avatarUrl}" alt="${person.name}" referrerpolicy="no-referrer">`;
  }
  return `<div class="${className}">${person.avatar || "?"}</div>`;
}

function personStats(personId) {
  const allCalls = state.calls.filter((call) => call.person?.id === personId);
  const calls = allCalls.filter(isScoredCall);
  const pnl = calls.reduce((sum, call) => sum + (call.returnPct || 0), 0);
  const wins = calls.filter((call) => (call.returnPct || 0) > 0).length;
  const losses = calls.filter((call) => (call.returnPct || 0) < 0).length;
  const best = [...calls].sort((a, b) => (b.returnPct || 0) - (a.returnPct || 0))[0];
  const worst = [...calls].sort((a, b) => (a.returnPct || 0) - (b.returnPct || 0))[0];
  return { calls, allCalls, pnl, wins, losses, best, worst, avg: calls.length ? pnl / calls.length : 0 };
}

function sourceLabel(call) {
  if (call.sourcePlatform === "X") return "X";
  if (call.sourcePlatform === "한국일보" || call.sourceUrl?.includes("hankookilbo.com")) return "기사";
  if (call.sourceUrl?.includes("inews24.com")) return "기사";
  if (call.sourceUrl?.includes("finance.yahoo.com")) return "기사";
  if (call.sourceUrl?.includes("theblock.co")) return "기사";
  return call.sourcePlatform || "출처";
}

function sourceDomain(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url || "출처 없음";
  }
}

function statusClass(status = "") {
  if (status.includes("verified")) return "verified";
  if (status.includes("live") || status.includes("ai")) return "live";
  return "candidate";
}

function callDateLabel(date = "") {
  if (!date) return "시점 미상";
  try {
    return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric" }).format(new Date(date));
  } catch {
    return date;
  }
}

function personSourceLinks(person) {
  const sources = Array.isArray(person.sources) ? person.sources : String(person.sources || "").split(/\s+/).filter(Boolean);
  return sources.slice(0, 3).map((url) => `<a href="${url}" target="_blank" rel="noreferrer">${sourceDomain(url)}</a>`).join("");
}

function holdingPeriod(date) {
  if (!date) return "-";
  const days = Math.max(1, Math.round((Date.now() - new Date(date).getTime()) / 86400000));
  if (days > 365) return `${Math.floor(days / 365)}년 ${Math.floor((days % 365) / 30)}개월`;
  if (days > 30) return `${Math.floor(days / 30)}개월 ${days % 30}일`;
  return `${days}일`;
}

function switchTab(tab) {
  qsa(".tab").forEach((node) => node.classList.toggle("active", node.id === `tab-${tab}`));
  qsa(".bottom-nav button").forEach((node) => node.classList.toggle("active", node.dataset.tab === tab));
  const titles = { search: "검색", feed: "피드", rank: "랭킹", me: "마이" };
  qs("#page-title").textContent = titles[tab];
}

function renderOrbitalAvatars() {
  const container = qs("#orbital-avatars");
  if (!container) return;
  const people = state.people.filter((person) => person.avatarUrl).slice(0, 10);
  const rows = [people, [...people].reverse(), [...people.slice(3), ...people.slice(0, 3)]];
  container.innerHTML = rows.map((row, rowIndex) => {
    const doubled = [...row, ...row, ...row];
    return `
      <div class="avatar-marquee row-${rowIndex + 1}">
        <div class="avatar-track">
          ${doubled.map((person) => `
            <img src="${person.avatarUrl}" alt="" referrerpolicy="no-referrer">
          `).join("")}
        </div>
      </div>
    `;
  }).join("");
}

function ideaRow(call) {
  const direction = call.callType === "mention_candidate" ? "관찰" : "긍정";
  return `
    <div class="idea-row">
      <button class="asset-jump" data-symbol="${call.symbol}" type="button" aria-label="${displayAsset(call.symbol)} 보기">
        ${assetIcon(call.symbol, "asset-badge")}
      </button>
      <div class="idea-main">
        <div class="idea-title-line">
          <strong>${displayAsset(call.symbol)}</strong>
          <span class="direction">${direction}</span>
          <span class="verify-badge ${statusClass(call.status)}">${statusKo(call.status)}</span>
        </div>
        <p>${positiveReason(call)}</p>
        <div class="idea-meta">
          <span>${callDateLabel(call.calledAt)}</span>
          <a href="${call.sourceUrl}" target="_blank" rel="noreferrer">${sourceLabel(call)} · ${sourceDomain(call.sourceUrl)}</a>
        </div>
      </div>
      <em>${isScoredCall(call) ? price(call.currentPrice, call.currency) : "가격 확인 전"}</em>
      <button class="idea-open ${returnClass(call)}" data-call-id="${call.id}" type="button">${isScoredCall(call) ? pct(call.returnPct) : "검증 전"}</button>
    </div>
  `;
}

function receiptGroup(title, subtitle, calls, person) {
  const main = calls[0];
  return `
    <article class="receipt-group">
      <header>
        ${avatar(person || { avatar: assetLogo(main.symbol), name: main.symbol })}
        <div>
          <strong>${person?.handle || person?.name || title}</strong>
          <span>${sourceLabel(main)} · ${holdingPeriod(main.calledAt)} 전</span>
        </div>
        <button class="copy-mini" data-call-id="${main.id}" type="button">↗</button>
      </header>
      <h3>${title}</h3>
      <div class="source-line">
        <span>${callDateLabel(main.calledAt)}</span>
        <span class="verify-badge ${statusClass(main.status)}">${statusKo(main.status)}</span>
        <a href="${main.sourceUrl}" target="_blank" rel="noreferrer">${sourceDomain(main.sourceUrl)}</a>
      </div>
      <div class="idea-count">아이디어 · ${calls.length}</div>
      <div class="idea-list">${calls.map(ideaRow).join("")}</div>
      <a href="${main.sourceUrl}" target="_blank" rel="noreferrer">원문 보기 ↗</a>
    </article>
  `;
}

function chartPath(points) {
  return points.map((point, index) => {
    const command = index === 0 ? "M" : "L";
    return `${command}${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }).join(" ");
}

function axisPrice(value, currency = "USD") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  if (currency === "KRW") {
    if (Math.abs(number) >= 100000000) return `${(number / 100000000).toFixed(1)}억`;
    if (Math.abs(number) >= 10000) return `${Math.round(number / 10000)}만`;
    return `${Math.round(number).toLocaleString("ko-KR")}`;
  }
  if (Math.abs(number) >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
  if (Math.abs(number) >= 1000) return `${(number / 1000).toFixed(1)}K`;
  if (Math.abs(number) >= 10) return number.toFixed(1);
  return number.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function axisDate(value, span = 0) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const options = span > 370 * 86400000
    ? { year: "2-digit", month: "short" }
    : { month: "short", day: "numeric" };
  return new Intl.DateTimeFormat("ko-KR", options).format(date);
}

function timelineWindowStart(windowKey, endTime) {
  const days = {
    "1m": 30,
    "6m": 180,
    "1y": 365
  }[windowKey];
  return days ? endTime - days * 86400000 : null;
}

function timelineModel(calls, windowKey = state.assetWindow) {
  const sorted = [...calls].sort((a, b) => new Date(a.calledAt) - new Date(b.calledAt));
  const latest = sorted[sorted.length - 1];
  const endTime = Math.max(Date.now(), new Date(latest?.calledAt || Date.now()).getTime());
  const windowStart = timelineWindowStart(windowKey, endTime);
  const visibleCalls = sorted.filter((call) => {
    const time = new Date(call.calledAt).getTime();
    return !windowStart || time >= windowStart;
  });
  const effectiveCalls = visibleCalls.length ? visibleCalls : sorted.slice(-1);
  const startTime = windowStart || new Date(sorted[0]?.calledAt || Date.now()).getTime();
  const currentPrice = Number(latest?.currentPrice);
  const chart = state.chartData[sorted[0]?.symbol]?.[windowKey];
  const liveEvents = (chart?.points || []).map((point) => ({
    time: Number(point.time),
    price: Number(point.close)
  })).filter((item) => Number.isFinite(item.time) && Number.isFinite(item.price));
  const priceEvents = liveEvents.length
    ? liveEvents
    : [
      ...effectiveCalls.map((call) => ({ time: new Date(call.calledAt).getTime(), price: Number(call.entryPrice) })),
      ...(Number.isFinite(currentPrice) ? [{ time: endTime, price: currentPrice }] : [])
    ].filter((item) => Number.isFinite(item.price));

  if (!priceEvents.length) {
    return { sorted, visibleCalls: effectiveCalls, points: [], markers: [], currentPrice, currentX: 0, currentY: 0, xTicks: [], yTicks: [] };
  }

  const firstEventTime = priceEvents[0].time;
  const lastEventTime = priceEvents[priceEvents.length - 1].time;
  const chartStartTime = liveEvents.length ? Math.min(firstEventTime, startTime) : startTime;
  const chartEndTime = liveEvents.length ? lastEventTime : endTime;
  const minPrice = Math.min(...priceEvents.map((item) => item.price));
  const maxPrice = Math.max(...priceEvents.map((item) => item.price));
  const pad = (maxPrice - minPrice || Math.max(1, maxPrice)) * 0.16;
  const low = minPrice - pad;
  const high = maxPrice + pad;
  const timeSpan = Math.max(1, chartEndTime - chartStartTime);
  const priceSpan = Math.max(1, high - low);
  const xOf = (time) => 70 + ((time - chartStartTime) / timeSpan) * 840;
  const yOf = (value) => 350 - ((value - low) / priceSpan) * 270;
  const anchors = [...priceEvents].sort((a, b) => a.time - b.time);
  const points = liveEvents.length
    ? anchors.map((event) => ({ x: xOf(event.time), y: yOf(event.price) }))
    : Array.from({ length: 75 }, (_, index) => {
      const time = chartStartTime + (timeSpan * index) / 74;
      let left = anchors[0];
      let right = anchors[anchors.length - 1];
      for (let anchorIndex = 0; anchorIndex < anchors.length - 1; anchorIndex += 1) {
        if (time >= anchors[anchorIndex].time && time <= anchors[anchorIndex + 1].time) {
          left = anchors[anchorIndex];
          right = anchors[anchorIndex + 1];
          break;
        }
      }
      const ratio = right.time === left.time ? 0 : (time - left.time) / (right.time - left.time);
      const base = left.price + (right.price - left.price) * Math.max(0, Math.min(1, ratio));
      const wave = Math.sin(index * 0.75) * (high - low) * 0.015;
      return { x: xOf(time), y: yOf(base + wave) };
    });

  const markers = effectiveCalls.map((call) => {
    const time = new Date(call.calledAt).getTime();
    const value = Number(call.entryPrice);
    return {
      call,
      x: Math.max(70, Math.min(910, xOf(time))),
      y: Math.max(74, Math.min(350, yOf(value)))
    };
  }).filter(({ call }) => {
    const time = new Date(call.calledAt).getTime();
    return time >= chartStartTime && time <= chartEndTime;
  });
  const current = anchors[anchors.length - 1];
  const currency = chart?.currency || sorted[0]?.currency;
  const yTicks = Array.from({ length: 5 }, (_, index) => {
    const value = low + ((high - low) * index) / 4;
    return {
      value,
      label: axisPrice(value, currency),
      y: Math.max(64, Math.min(370, yOf(value)))
    };
  }).reverse();
  const xTicks = Array.from({ length: 5 }, (_, index) => {
    const time = chartStartTime + ((chartEndTime - chartStartTime) * index) / 4;
    return {
      time,
      label: axisDate(time, chartEndTime - chartStartTime),
      x: Math.max(70, Math.min(910, xOf(time)))
    };
  });

  return {
    sorted,
    visibleCalls: effectiveCalls,
    points,
    markers,
    currentPrice: Number(chart?.currentPrice ?? currentPrice),
    currency,
    xTicks,
    yTicks,
    currentX: Math.max(70, Math.min(910, xOf(current.time))),
    currentY: Math.max(74, Math.min(350, yOf(current.price)))
  };
}

function shouldUseTradingView(symbol) {
  return false;
}

function internalTimelineChart(calls, symbol) {
  const model = timelineModel(calls);
  const path = chartPath(model.points);
  const gradientId = `timeline-fill-${symbol.replace(/\W/g, "")}`;
  const ranges = [
    ["1m", "1개월"],
    ["6m", "6개월"],
    ["1y", "1년"],
    ["all", "전체"]
  ];

  return `
    <div class="internal-chart" data-symbol="${symbol}">
      <div class="chart-toolbar">
        <strong>${assetName(symbol)} 가격 흐름</strong>
        <div class="chart-ranges">
          ${ranges.map(([key, label]) => `
            <button class="${state.assetWindow === key ? "active" : ""}" data-asset-range="${key}" data-range-symbol="${symbol}" type="button">${label}</button>
          `).join("")}
        </div>
      </div>
      <div class="chart-canvas">
        <svg viewBox="0 0 1000 430" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stop-color="#6dd37f" stop-opacity="0.26" />
              <stop offset="100%" stop-color="#6dd37f" stop-opacity="0" />
            </linearGradient>
          </defs>
          <g class="grid-lines">
            ${[90, 155, 220, 285, 350].map((y) => `<line x1="54" x2="940" y1="${y}" y2="${y}"></line>`).join("")}
            ${[70, 245, 420, 595, 770, 940].map((x) => `<line x1="${x}" x2="${x}" y1="62" y2="370"></line>`).join("")}
          </g>
          <g class="axis-labels y-axis">
            ${model.yTicks.map((tick) => `
              <text x="948" y="${tick.y.toFixed(1)}" dominant-baseline="middle">${tick.label}</text>
            `).join("")}
          </g>
          <g class="axis-labels x-axis">
            ${model.xTicks.map((tick) => `
              <text x="${tick.x.toFixed(1)}" y="406" text-anchor="middle">${tick.label}</text>
            `).join("")}
          </g>
          <path class="price-area" d="${path} L 910 372 L 70 372 Z" fill="url(#${gradientId})"></path>
          <path class="price-line" d="${path}"></path>
        </svg>
        <div class="current-price-pin" style="left:${(model.currentX / 1000) * 100}%; top:${(model.currentY / 430) * 100}%;">
          <span>현재가</span>
          <strong>${price(model.currentPrice, model.currency || model.sorted[0]?.currency)}</strong>
        </div>
        ${model.markers.map(({ call, x, y }) => `
          <button class="chart-marker" data-call-id="${call.id}" type="button" style="left:${(x / 1000) * 100}%; top:${(y / 430) * 100}%;">
            ${avatar(call.person, "marker-avatar")}
            <span class="marker-tip">
              <strong>${call.person?.name}</strong>
              <em>${call.calledAt} · 당시 가격 ${price(call.entryPrice, call.currency)}</em>
              <small>${positiveReason(call)}</small>
            </span>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function legacyAssetTimeline(calls, symbol) {
  const sorted = [...calls].sort((a, b) => new Date(a.calledAt) - new Date(b.calledAt));
  const latest = sorted[sorted.length - 1];
  const tvSymbol = tradingViewSymbol(symbol);
  const prices = sorted.map((call) => Number(call.entryPrice)).filter((value) => Number.isFinite(value));
  const current = Number(latest?.currentPrice);
  if (Number.isFinite(current)) prices.push(current);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const pricePad = (max - min || 1) * 0.14;
  const minPrice = min - pricePad;
  const maxPrice = max + pricePad;
  const priceSpan = maxPrice - minPrice || 1;
  const startTime = new Date(sorted[0]?.calledAt).getTime();
  const endTime = Math.max(new Date(latest?.calledAt).getTime(), Date.now());
  const timeSpan = Math.max(1, endTime - startTime);
  const markerPoints = sorted.map((call) => {
    const x = 10 + ((new Date(call.calledAt).getTime() - startTime) / timeSpan) * 78;
    const y = 78 - ((Number(call.entryPrice) - minPrice) / priceSpan) * 54;
    return {
      call,
      x: Math.max(10, Math.min(88, x)),
      y: Math.max(18, Math.min(78, y))
    };
  });

  return `
    <section class="asset-timeline">
      <div class="timeline-head">
        <div>
          <span>실시간 차트</span>
          <h3>${assetName(symbol)} 가격 흐름</h3>
        </div>
        <strong>${tvSymbol}</strong>
      </div>
      <div class="tradingview-wrap">
        <iframe
          title="${assetName(symbol)} TradingView chart"
          srcdoc="${escapeAttribute(tradingViewSrcDoc(symbol))}"
          loading="lazy"
          allowtransparency="true"
          frameborder="0">
        </iframe>
        <div class="tv-marker-layer" aria-label="긍정 의견 시점">
          ${markerPoints.map(({ call, x, y }) => `
            <button class="tv-call-marker" data-call-id="${call.id}" type="button" style="left:${x}%; top:${y}%;">
              ${avatar(call.person, "marker-avatar")}
              <span class="marker-tip">
                <strong>${call.person?.name}</strong>
                <em>${call.calledAt} · 당시 가격 ${price(call.entryPrice, call.currency)}</em>
                <small>${positiveReason(call)}</small>
              </span>
            </button>
          `).join("")}
        </div>
      </div>
      <div class="opinion-rail">
        <div class="rail-title">의견이 나온 시점</div>
        <div class="rail-list">
          ${sorted.map((call) => `
            <div class="rail-item">
              <button class="rail-person" data-person-id="${call.person?.id || ""}" type="button" aria-label="${call.person?.name} 보기">
                ${avatar(call.person, "rail-avatar")}
              </button>
              <button class="rail-person-name" data-person-id="${call.person?.id || ""}" type="button">${call.person?.name}</button>
              <button class="rail-detail" data-call-id="${call.id}" type="button">
                <small>${call.calledAt} · 당시 ${price(call.entryPrice, call.currency)}</small>
              </button>
            </div>
          `).join("")}
        </div>
      </div>
    </section>
  `;
}

function assetTimeline(calls, symbol) {
  const sorted = [...calls].sort((a, b) => new Date(a.calledAt) - new Date(b.calledAt));
  const tvSymbol = tradingViewSymbol(symbol);
  const chart = shouldUseTradingView(symbol)
    ? `
      <div class="tradingview-wrap">
        <iframe
          title="${assetName(symbol)} TradingView chart"
          srcdoc="${escapeAttribute(tradingViewSrcDoc(symbol))}"
          loading="lazy"
          allowtransparency="true"
          frameborder="0">
        </iframe>
      </div>
    `
    : internalTimelineChart(calls, symbol);

  return `
    <section class="asset-timeline">
      <div class="timeline-head">
        <div>
          <span>실시간 차트</span>
          <h3>${assetName(symbol)} 가격 흐름</h3>
        </div>
        <strong>${tvSymbol}</strong>
      </div>
      ${chart}
      <div class="opinion-rail">
        <div class="rail-title">의견이 나온 시점</div>
        <div class="rail-list">
          ${sorted.map((call) => `
            <div class="rail-item">
              <button class="rail-person" data-person-id="${call.person?.id || ""}" type="button" aria-label="${call.person?.name} 보기">
                ${avatar(call.person, "rail-avatar")}
              </button>
              <button class="rail-person-name" data-person-id="${call.person?.id || ""}" type="button">${call.person?.name}</button>
              <button class="rail-detail" data-call-id="${call.id}" type="button">
                <small>${call.calledAt} · 당시 ${price(call.entryPrice, call.currency)}</small>
              </button>
            </div>
          `).join("")}
        </div>
      </div>
    </section>
  `;
}

function bindCallRows() {
  qsa("[data-asset-range]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      state.assetWindow = button.dataset.assetRange || "all";
      renderAsset(button.dataset.rangeSymbol);
    });
  });
  qsa("[data-call-id]").forEach((row) => {
    row.addEventListener("click", () => {
      const call = state.calls.find((item) => item.id === row.dataset.callId);
      if (!call) return;
      state.selectedCall = call;
      showIdeaDetail(call);
    });
  });
  qsa("[data-symbol]").forEach((row) => {
    row.addEventListener("click", (event) => {
      event.stopPropagation();
      const symbol = row.dataset.symbol;
      if (symbol) renderAsset(symbol);
    });
  });
  qsa(".rail-person, .rail-person-name").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      const person = state.people.find((item) => item.id === node.dataset.personId);
      if (person) {
        qs("#share-card").classList.add("hidden");
        renderPerson(person);
      }
    });
  });
}

function resetSearchView() {
  state.currentAsset = null;
  qs("#search-empty").classList.remove("hidden");
  qs("#asset-view").classList.add("hidden");
  qs("#person-view").classList.add("hidden");
  qs("#search-live").innerHTML = "";
}

function chartCacheKey(symbol, range = state.assetWindow) {
  return `${symbol}:${range}`;
}

function applyChartDataToCalls(symbol, chart) {
  const current = Number(chart?.currentPrice);
  if (!Number.isFinite(current)) return;
  const points = Array.isArray(chart?.points) ? chart.points : [];
  const maxDistance = chart?.range === "all" ? 21 * 86400000 : 7 * 86400000;
  const nearestClose = (date) => {
    const target = new Date(date).getTime();
    if (!Number.isFinite(target) || !points.length) return null;
    let best = null;
    for (const point of points) {
      const time = Number(point.time);
      const close = Number(point.close);
      if (!Number.isFinite(time) || !Number.isFinite(close)) continue;
      const distance = Math.abs(time - target);
      if (!best || distance < best.distance) best = { close, distance };
    }
    return best && best.distance <= maxDistance ? best.close : null;
  };

  state.calls = state.calls.map((call) => {
    if (call.symbol !== symbol) return call;
    const chartEntry = nearestClose(call.calledAt);
    const entry = Number(chartEntry ?? call.entryPrice);
    const returnPct = Number.isFinite(entry) && entry > 0 ? ((current - entry) / entry) * 100 : call.returnPct;
    return {
      ...call,
      entryPrice: entry,
      currentPrice: current,
      currency: chart.currency || call.currency,
      returnPct
    };
  });
}

async function fetchAssetChart(symbol, range = state.assetWindow) {
  state.chartData[symbol] ||= {};
  const key = chartCacheKey(symbol, range);
  if (state.chartData[symbol][range] || state.chartLoading[key]) return;
  state.chartLoading[key] = true;

  try {
    const response = await fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`);
    if (!response.ok) throw new Error("chart request failed");
    const chart = await response.json();
    if (!Array.isArray(chart.points) || !chart.points.length) throw new Error("empty chart");
    state.chartData[symbol][range] = chart;
    applyChartDataToCalls(symbol, chart);
    if (state.currentAsset === symbol) renderAsset(symbol, { skipChartFetch: true });
    renderLeaderboard();
    renderFeed();
  } catch {
    state.chartData[symbol][range] = { failed: true, points: [] };
  } finally {
    state.chartLoading[key] = false;
  }
}

function renderAsset(symbol, options = {}) {
  state.currentAsset = symbol;
  const calls = state.calls
    .filter((call) => call.symbol.toLowerCase() === symbol.toLowerCase() || assetName(call.symbol).toLowerCase().includes(symbol.toLowerCase()))
    .sort((a, b) => new Date(b.calledAt) - new Date(a.calledAt));
  if (!calls.length) return false;

  const scoredCalls = calls.filter(isScoredCall);
  const rankingCalls = scoredCalls.length ? scoredCalls : calls;
  const best = [...rankingCalls].sort((a, b) => (b.returnPct || 0) - (a.returnPct || 0))[0];
  const first = [...rankingCalls].sort((a, b) => new Date(a.calledAt) - new Date(b.calledAt))[0];
  qs("#search-empty").classList.add("hidden");
  qs("#person-view").classList.add("hidden");
  qs("#asset-view").classList.remove("hidden");
  qs("#asset-view").innerHTML = `
    <div class="asset-hero">
      <button class="back-button" type="button">‹</button>
      ${assetIcon(best.symbol, "coin-icon")}
      <div>
        <h2>${displayAsset(best.symbol)}</h2>
        <p>${best.symbol.endsWith(".KS") ? best.symbol : assetName(best.symbol)}</p>
      </div>
      <div class="asset-price">
        <strong>${price(best.currentPrice, best.currency)}</strong>
        ${pctTag(best.returnPct)}
      </div>
    </div>
    <div class="summary-pills">
      <div><span>가장 성과가 좋았던 사람</span><strong>${best.person?.name} ${pctTag(best.returnPct)}</strong></div>
      <div><span>가장 먼저 긍정 의견을 낸 사람</span><strong>${first.person?.name} · ${first.calledAt}</strong></div>
    </div>
    <div class="tabs-line">
      <button class="active">긍정 의견 (${calls.length})</button>
      <button>정보</button>
    </div>
    ${assetTimeline(calls, best.symbol)}
    ${calls.map((call) => receiptGroup(`${assetName(call.symbol)}를 좋게 본 기록`, `${call.symbol}`, [call], call.person)).join("")}
  `;
  qs("#asset-view .back-button").addEventListener("click", resetSearchView);
  bindCallRows();
  if (!options.skipChartFetch) fetchAssetChart(best.symbol, state.assetWindow);
  return true;
}

function renderPerson(person) {
  state.currentAsset = null;
  const ownCalls = state.calls
    .filter((call) => call.personId === person.id || call.person?.id === person.id)
    .map((call) => ({ ...call, person }));
  const scoredCalls = ownCalls.filter(isScoredCall);
  const pnl = scoredCalls.reduce((sum, call) => sum + (call.returnPct || 0), 0);
  const stats = {
    calls: scoredCalls,
    allCalls: ownCalls,
    wins: scoredCalls.filter((call) => (call.returnPct || 0) > 0).length,
    losses: scoredCalls.filter((call) => (call.returnPct || 0) < 0).length,
    best: [...scoredCalls].sort((a, b) => (b.returnPct || 0) - (a.returnPct || 0))[0],
    worst: [...scoredCalls].sort((a, b) => (a.returnPct || 0) - (b.returnPct || 0))[0],
    avg: scoredCalls.length ? pnl / scoredCalls.length : 0
  };
  const displayCalls = [...ownCalls].sort((a, b) => {
    if (isScoredCall(a) !== isScoredCall(b)) return isScoredCall(a) ? -1 : 1;
    return (b.returnPct || 0) - (a.returnPct || 0);
  });
  if (!displayCalls.length) return false;
  const bestLabel = stats.best ? `${displayAsset(stats.best.symbol)} ${pctTag(stats.best.returnPct)}` : "원문 확인 필요";
  const worstLabel = stats.worst ? `${displayAsset(stats.worst.symbol)} ${pctTag(stats.worst.returnPct)}` : "원문 확인 필요";
  qs("#search-empty").classList.add("hidden");
  qs("#asset-view").classList.add("hidden");
  qs("#person-view").classList.remove("hidden");
  qs("#person-view").innerHTML = `
    <div class="person-hero">
      <button class="back-button" type="button">‹</button>
      <div class="person-left">
        ${avatar(person, "avatar-img xl")}
        <div>
          <h2>${person.name}</h2>
          <p>${person.handle || categoryKo(person.category)}</p>
        </div>
        <span>${bioKo(person)}</span>
        <div class="person-sources">
          <small>주요 출처</small>
          ${personSourceLinks(person)}
        </div>
      </div>
      <div class="person-right">
        <button class="follow-button ${isFollowing(person.id) ? "following" : ""}" data-follow-id="${person.id}">${isFollowing(person.id) ? "팔로잉" : "팔로우"}</button>
        <div class="person-meta">
          <div><strong>${stats.calls.length}</strong><small>원문 확인</small></div>
          <div><strong>${stats.wins}</strong><small>성과 좋음</small></div>
          <div><strong>${stats.losses}</strong><small>아쉬움</small></div>
        </div>
        <div class="person-return">
          <span>평균 성과</span>
          <strong class="${pnlClass(stats.avg)}">${pct(stats.avg)}</strong>
        </div>
      </div>
    </div>
    <div class="performance-panel slim">
      <div><span>가장 좋았던 의견</span><strong>${bestLabel}</strong></div>
      <div><span>아쉬웠던 의견</span><strong>${worstLabel}</strong></div>
    </div>
    ${receiptGroup(`${person.name}이 긍정적으로 본 아이디어`, person.handle, displayCalls, person)}
  `;
  qs("#person-view .back-button").addEventListener("click", resetSearchView);
  qs("#person-view [data-follow-id]")?.addEventListener("click", () => {
    toggleFollow(person.id);
    renderPerson(person);
  });
  bindCallRows();
  return true;
}

function renderLive(calls) {
  const sorted = [...calls].sort((a, b) => new Date(b.calledAt).getTime() - new Date(a.calledAt).getTime());
  qs("#search-live").innerHTML = sorted.length ? `
    <h2 class="section-title">방금 찾은 긍정 의견</h2>
    ${sorted.map((call) => receiptGroup(`${call.person?.name || "공개 계정"}의 긍정 의견`, call.symbol, [call], call.person)).join("")}
  ` : `<div class="loading">아직 열린 공개 의견이 없어요. 다른 키워드로 다시 검색해보세요.</div>`;
  bindCallRows();
}

function renderUnknownSearch(query) {
  qs("#search-empty").classList.add("hidden");
  qs("#asset-view").classList.add("hidden");
  qs("#person-view").classList.add("hidden");
  qs("#search-live").innerHTML = `
    <section class="confirm-search-card">
      <span>새로운 대상</span>
      <h2>${query} 맞나요?</h2>
      <p>아직 저장된 데이터에는 없어요. 맞다면 공개 포스트와 영상을 찾아 긍정 의견을 추려볼게요.</p>
      <div class="confirm-actions">
        <button id="confirm-live-search" type="button">라이브로 찾아보기</button>
        <button id="cancel-live-search" type="button">다시 입력하기</button>
      </div>
    </section>
  `;
  qs("#confirm-live-search").addEventListener("click", () => runLiveSearchOnly(query));
  qs("#cancel-live-search").addEventListener("click", resetSearchView);
}

function renderLeaderboard() {
  const multipliers = { "24h": 1, "7d": 0.92, "30d": 1.08, all: 1.18 };
  const multiplier = multipliers[state.rankWindow] || 1;
  const rows = state.people
    .map((person) => {
      const stats = personStats(person.id);
      return { person, ...stats, displayAvg: stats.avg * multiplier };
    })
    .filter((row) => row.calls.length)
    .sort((a, b) => b.displayAvg - a.displayAvg);

  qs("#leaderboard").innerHTML = rows.map((row, index) => `
    <button class="rank-row" data-person-id="${row.person.id}">
      <div class="rank-no">${index + 1}</div>
      ${avatar(row.person)}
      <div class="rank-name">
        <strong>${row.person.name}</strong>
        <span>${row.person.handle || categoryKo(row.person.category)}</span>
      </div>
      <div class="rank-pnl">
        <strong class="${pnlClass(row.displayAvg)}">${pct(row.displayAvg)}</strong>
        <span>${row.wins}개 성과 좋음 · ${row.losses}개 아쉬움 · 총 ${row.calls.length}개</span>
      </div>
    </button>
  `).join("");

  qsa(".rank-row").forEach((row) => row.addEventListener("click", () => {
    const person = state.people.find((item) => item.id === row.dataset.personId);
    switchTab("search");
    renderPerson(person);
  }));
}

function bindRankingTabs() {
  qsa(".segmented button").forEach((button) => {
    button.addEventListener("click", () => {
      state.rankWindow = button.dataset.window || "24h";
      qsa(".segmented button").forEach((item) => item.classList.toggle("active", item === button));
      renderLeaderboard();
    });
  });
}

function renderFeed() {
  const calls = state.calls.filter(isScoredCall).sort((a, b) => {
    const dateDiff = new Date(b.calledAt).getTime() - new Date(a.calledAt).getTime();
    if (dateDiff) return dateDiff;
    return (b.viralScore || 0) - (a.viralScore || 0);
  });
  qs("#activity-feed").innerHTML = calls.map((call, index) => `
    <article class="activity-row">
      <button class="feed-person" data-person-id="${call.person?.id || ""}" type="button">
        ${avatar(call.person)}
      </button>
      <div class="activity-main">
        <p><button class="feed-name" data-person-id="${call.person?.id || ""}" type="button">${call.person?.name}</button>이 <b>${displayAsset(call.symbol)}</b>에 긍정 의견을 냈어요 <span>${callDateLabel(call.calledAt)} · ${holdingPeriod(call.calledAt)} 전</span></p>
        <button class="mini-position" data-call-id="${call.id}" type="button">
          <div>
            <strong>${assetName(call.symbol)}</strong>
            <span>${statusKo(call.status)}</span>
          </div>
          <div>
            <strong>${price(call.currentPrice, call.currency)}</strong>
            <span class="${returnClass(call)}">${returnLabel(call)}</span>
          </div>
        </button>
      </div>
    </article>
  `).join("");
  bindCallRows();
  qsa("[data-person-id]").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      const person = state.people.find((item) => item.id === node.dataset.personId);
      if (!person) return;
      switchTab("search");
      renderPerson(person);
    });
  });
}

function renderFollowing() {
  const list = qs("#following-list");
  if (!list) return;

  if (!state.session) {
    list.innerHTML = `
      <section class="login-card">
        <div>
          <span>RECEIPTS.TRADE</span>
          <h2>내 계정으로 팔로우 관리</h2>
          <p>이름과 이메일만 넣으면 데모용 계정이 만들어지고, 팔로우와 알림 설정이 이 브라우저에 저장됩니다.</p>
        </div>
        <form id="login-form" class="login-form">
          <input id="login-name" name="name" type="text" placeholder="이름" required>
          <input id="login-email" name="email" type="email" placeholder="email@example.com" required>
          <button type="submit">로그인</button>
        </form>
      </section>
    `;
    qs("#login-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      state.session = {
        name: String(form.get("name") || "").trim(),
        email: String(form.get("email") || "").trim(),
        signedInAt: new Date().toISOString()
      };
      if (!state.following.length) {
        state.following = state.people.filter((person) => person.featured).slice(0, 2).map((person) => person.id);
      }
      saveLocalState();
      renderFollowing();
    });
    return;
  }

  const followed = state.people.filter((person) => isFollowing(person.id));
  const suggestions = state.people.filter((person) => !isFollowing(person.id)).slice(0, 6);
  const visiblePeople = followed.length ? followed : suggestions;
  const modeTitle = followed.length ? "내가 팔로우하는 사람" : "팔로우할 사람을 골라보세요";

  list.innerHTML = `
    <section class="account-card">
      <div class="brand-dot big">${state.session.name.slice(0, 1).toUpperCase()}</div>
      <div>
        <h2>${state.session.name}</h2>
        <p>${state.session.email} · ${state.following.length}명 팔로우 중</p>
      </div>
      <button id="logout-button" type="button">로그아웃</button>
    </section>
    <h2 class="section-title compact">${modeTitle}</h2>
    <div class="following-list inner">
      ${visiblePeople.map((person) => {
        const stats = personStats(person.id);
        return `
          <div class="follow-row">
            <button class="follow-person" data-person-id="${person.id}" type="button">${avatar(person)}</button>
            <div>
              <strong>${person.name}</strong>
              <span>${person.handle || categoryKo(person.category)} · 원문 확인 ${stats.calls.length}개</span>
            </div>
            <button data-follow-toggle="${person.id}" class="${isFollowing(person.id) ? "following" : ""}" type="button">
              ${isFollowing(person.id) ? "팔로잉" : "팔로우"}
            </button>
          </div>
        `;
      }).join("")}
    </div>
    ${followed.length ? `
      <h2 class="section-title compact">추천 인플루언서</h2>
      <div class="following-list inner">
        ${suggestions.slice(0, 4).map((person) => {
          const stats = personStats(person.id);
          return `
            <div class="follow-row">
              <button class="follow-person" data-person-id="${person.id}" type="button">${avatar(person)}</button>
              <div>
                <strong>${person.name}</strong>
                <span>${person.handle || categoryKo(person.category)} · 원문 확인 ${stats.calls.length}개</span>
              </div>
              <button data-follow-toggle="${person.id}" type="button">팔로우</button>
            </div>
          `;
        }).join("")}
      </div>
    ` : ""}
    <h2 class="section-title compact">알림 설정</h2>
    <div class="settings-list">
      <label><span>새 긍정 의견이 잡히면 알려주기</span><input data-setting="notifyNewIdeas" type="checkbox" ${state.notifyNewIdeas ? "checked" : ""}></label>
      <label><span>수익률이 크게 바뀌면 알려주기</span><input data-setting="notifyReturns" type="checkbox" ${state.notifyReturns ? "checked" : ""}></label>
      <label><span>매주 가장 잘 맞힌 사람 요약 받기</span><input data-setting="notifyWeekly" type="checkbox" ${state.notifyWeekly ? "checked" : ""}></label>
    </div>
  `;

  qs("#logout-button")?.addEventListener("click", () => {
    state.session = null;
    saveLocalState();
    renderFollowing();
  });

  qsa("[data-follow-toggle]").forEach((button) => {
    button.addEventListener("click", () => toggleFollow(button.dataset.followToggle));
  });

  qsa(".follow-person").forEach((button) => {
    button.addEventListener("click", () => {
      const person = state.people.find((item) => item.id === button.dataset.personId);
      if (person) {
        switchTab("search");
        renderPerson(person);
      }
    });
  });

  qsa("[data-setting]").forEach((input) => {
    input.addEventListener("change", () => {
      state[input.dataset.setting] = input.checked;
      saveLocalState();
    });
  });
}

function showShare(call) {
  const card = qs("#share-card");
  card.classList.remove("hidden");
  card.innerHTML = `
    <button class="close-share">×</button>
    <div class="receipt-card">
      <p>RECEIPTS.TRADE</p>
      <h2>${call.person?.name} · ${displayAsset(call.symbol)}</h2>
      <strong class="${pnlClass(call.returnPct)}">${pct(call.returnPct)}</strong>
      <span>당시 ${price(call.entryPrice, call.currency)} · 지금 ${price(call.currentPrice, call.currency)}</span>
      <em>${quoteKo(call)}</em>
      <small>${call.calledAt} · ${sourceLabel(call)} · 투자 조언이 아니에요</small>
    </div>
  `;
  qs(".close-share").addEventListener("click", () => card.classList.add("hidden"));
}

function showIdeaDetail(call) {
  const card = qs("#share-card");
  card.classList.remove("hidden");
  card.innerHTML = `
    <button class="close-share">×</button>
    <article class="idea-detail-card">
      <header>
        ${avatar(call.person)}
        <div>
          <strong>${call.person?.name}의 긍정 의견</strong>
          <span>${call.calledAt} · ${sourceLabel(call)}</span>
        </div>
        <button class="detail-asset" data-symbol="${call.symbol}" type="button">${displayAsset(call.symbol)}</button>
      </header>
      <h2>${assetName(call.symbol)}</h2>
      <div class="detail-metrics">
        <div><span>당시 가격</span><strong>${price(call.entryPrice, call.currency)}</strong></div>
        <div><span>현재 가격</span><strong>${price(call.currentPrice, call.currency)}</strong></div>
        <div><span>의견 이후</span><strong class="${pnlClass(call.returnPct)}">${pct(call.returnPct)}</strong></div>
      </div>
      <section>
        <span>긍정으로 판단한 이유</span>
        <p>${positiveReason(call)}</p>
      </section>
      <section>
        <span>원문에서 확인한 발언</span>
        <p>${quoteKo(call)}</p>
      </section>
      <a href="${call.sourceUrl}" target="_blank" rel="noreferrer">원문 출처 열기 ↗</a>
    </article>
  `;
  qs(".close-share").addEventListener("click", () => card.classList.add("hidden"));
  qs(".detail-asset").addEventListener("click", () => {
    card.classList.add("hidden");
    renderAsset(call.symbol);
  });
}

async function runSearch(query) {
  const lower = query.toLowerCase();
  const symbol = Object.keys(state.assets).find((item) => matchesAsset(item, lower));
  const person = state.people.find((item) =>
    item.name.toLowerCase().includes(lower) ||
    item.handle?.toLowerCase().includes(lower) ||
    lower.includes(item.handle?.toLowerCase().replace("@", ""))
  );

  if (symbol) {
    const rendered = renderAsset(symbol);
    if (!rendered) {
      renderUnknownSearch(`${assetName(symbol)} (${symbol})`);
      return;
    }
  } else if (person) renderPerson(person);
  else {
    renderUnknownSearch(query);
    return;
  }

  qs("#search-live").innerHTML = `<div class="loading">공개 포스트를 살펴보는 중...</div>`;
  const response = await fetch("/api/live-search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, mode: "standard" })
  });
  const data = await response.json();
  const existing = new Set(state.calls.map((call) => call.id));
  const fresh = (data.calls || []).filter((call) => !existing.has(call.id));
  state.calls = [...state.calls, ...fresh];
  renderLive(data.calls || []);
  renderLeaderboard();
  renderFeed();
  renderFollowing();
}

async function runLiveSearchOnly(query) {
  qs("#search-empty").classList.add("hidden");
  qs("#asset-view").classList.add("hidden");
  qs("#person-view").classList.add("hidden");
  qs("#search-live").innerHTML = `<div class="loading">라이브로 공개 포스트를 살펴보는 중...</div>`;

  const response = await fetch("/api/live-search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, mode: "standard" })
  });
  const data = await response.json();
  const existing = new Set(state.calls.map((call) => call.id));
  const fresh = (data.calls || []).filter((call) => !existing.has(call.id));
  state.calls = [...state.calls, ...fresh];
  renderLive(data.calls || []);
  renderLeaderboard();
  renderFeed();
  renderFollowing();
}

async function bootstrap() {
  const response = await fetch("/api/bootstrap");
  const data = await response.json();
  state.people = data.people;
  state.assets = data.assets;
  state.calls = data.calls;
  state.selectedCall = state.calls[0];
  renderOrbitalAvatars();
  renderLeaderboard();
  renderFeed();
  renderFollowing();
}

qsa(".bottom-nav button").forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});

qs("#search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const query = qs("#search-input").value.trim();
  if (query) runSearch(query);
});

qsa("[data-query]").forEach((button) => {
  button.addEventListener("click", () => {
    qs("#search-input").value = button.dataset.query;
    runSearch(button.dataset.query);
  });
});

qs("#share-current").addEventListener("click", () => {
  if (state.selectedCall) showShare(state.selectedCall);
});

loadLocalState();
bootstrap();
bindRankingTabs();
