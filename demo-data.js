// 114學年度公開授課示範資料 (符合教育局 11 大標準欄位)
const DEFAULT_OPEN_CLASSES = [
  {
    id: "OC-1001",
    sessionId: 1,
    date: "2025-10-02",
    period: "第 1 節",
    className: "302",
    teacher: "王大同",
    subject: "自然",
    unit: "第 1 單元 水生家族與神奇水生植物",
    prepHost: "張美珍 老師 (召集人)",
    coPrepGroup: "自然與科技領域全體教師",
    postPrepHost: "陳文雄 校長",
    observationGroup: "自然與科技領域全體教師",
    openType: "校內",
    status: "已公告",
    location: "三年二班教室 & 自然實驗室",
    maxObservers: 10,
    registeredObservers: [
      { name: "林志明", school: "本校", time: "2025-09-25 10:15" },
      { name: "許雅婷", school: "本校", time: "2025-09-26 14:30" }
    ],
    lessonPlanUrl: "https://drive.google.com/example/plan-1",
    notes: "請觀課老師準備觀察記錄表，預計安排實驗操作觀察。",
    createdDate: "2025-09-10"
  },
  {
    id: "OC-1002",
    sessionId: 2,
    date: "2025-10-20",
    period: "第 2 節",
    className: "507",
    teacher: "郭小貞",
    subject: "綜合",
    unit: "第 3 單元 團隊合作與社區關懷實踐",
    prepHost: "李曉芳 老師",
    coPrepGroup: "1. 國小綜合領域輔導團團員\n2. 綜合領域全體授課教師\n3. 本市各校報名老師",
    postPrepHost: "唐永安 校長",
    observationGroup: "1. 國小綜合領域輔導團團員\n2. 綜合領域全體授課教師\n3. 本市各校報名老師",
    openType: "市級",
    status: "已公告",
    location: "五樓視聽教室",
    maxObservers: 25,
    registeredObservers: [
      { name: "黃美麗", school: "中山國小", time: "2025-10-01 09:12" },
      { name: "吳宗翰", school: "信義國小", time: "2025-10-02 11:05" },
      { name: "鄭秀英", school: "本校", time: "2025-10-03 15:40" }
    ],
    lessonPlanUrl: "https://drive.google.com/example/plan-2",
    notes: "市級公開授課，會後安排 40 分鐘共同議課研討會。",
    createdDate: "2025-09-15"
  },
  {
    id: "OC-1003",
    sessionId: 3,
    date: "2025-10-23",
    period: "第 1 節",
    className: "605",
    teacher: "劉大華",
    subject: "國語",
    unit: "第 5 課 閱讀素養與思辨寫作",
    prepHost: "劉大華 老師",
    coPrepGroup: "1. 國小語文領域輔導團團員\n2. 國語領域全體教師\n3. 板土區各校報名老師",
    postPrepHost: "周玉梅 老師 (召集人)",
    observationGroup: "1. 國小語文領域輔導團團員\n2. 國語領域全體教師\n3. 板土區各校報名老師",
    openType: "區級",
    status: "已公告",
    location: "六年五班教室",
    maxObservers: 15,
    registeredObservers: [
      { name: "蔡家豪", school: "後埔國小", time: "2025-10-05 08:30" }
    ],
    lessonPlanUrl: "https://drive.google.com/example/plan-3",
    notes: "提供 iPad 數位化議課心智圖紀錄。",
    createdDate: "2025-09-18"
  },
  {
    id: "OC-1004",
    sessionId: 4,
    date: "2025-11-05",
    period: "第 3 節",
    className: "401",
    teacher: "陳建宏",
    subject: "數學",
    unit: "第 4 單元 分數與小數的轉換應用",
    prepHost: "謝立文 老師",
    coPrepGroup: "數學領域全體教師",
    postPrepHost: "教務主任",
    observationGroup: "本校中高年級數學授課教師",
    openType: "校內",
    status: "已公告",
    location: "四年一班智慧教室",
    maxObservers: 8,
    registeredObservers: [],
    lessonPlanUrl: "",
    notes: "使用平板結合互動軟體進行形成性評量。",
    createdDate: "2025-09-20"
  },
  {
    id: "OC-1005",
    sessionId: 5,
    date: "2025-11-14",
    period: "第 2 節",
    className: "203",
    teacher: "林品妤",
    subject: "英語",
    unit: "Unit 3 Animals and Their Habitats",
    prepHost: "林品妤 老師",
    coPrepGroup: "英語領域輔導小組與外籍教師",
    postPrepHost: "張校長",
    observationGroup: "全校英語教師及低年級導師",
    openType: "校內",
    status: "待審核",
    location: "英語專科教室 (一)",
    maxObservers: 12,
    registeredObservers: [],
    lessonPlanUrl: "",
    notes: "雙語教學示範場次，搭配繪本導讀。",
    createdDate: "2025-10-01"
  },
  {
    id: "OC-1006",
    sessionId: 6,
    date: "2025-12-02",
    period: "第 4 節",
    className: "102",
    teacher: "曾怡君",
    subject: "藝文",
    unit: "第 2 單元 色彩魔法師與造型創作",
    prepHost: "曾怡君 老師",
    coPrepGroup: "藝術領域全體教師",
    postPrepHost: "輔導主任",
    observationGroup: "全校藝文教師",
    openType: "校內",
    status: "草稿",
    location: "美勞教室 (二)",
    maxObservers: 10,
    registeredObservers: [],
    lessonPlanUrl: "",
    notes: "材料準備中，預計下週送交教務處審核。",
    createdDate: "2025-10-05"
  },
  {
    id: "OC-1007",
    sessionId: 7,
    date: "2025-12-18",
    period: "第 2 節",
    className: "503",
    teacher: "方永傑",
    subject: "科技",
    unit: "第 2 單元 Scratch 運算思維與遊戲設計",
    prepHost: "方永傑 老師",
    coPrepGroup: "科技領域輔導團",
    postPrepHost: "資訊組長",
    observationGroup: "全市科技領域教師",
    openType: "市級",
    status: "已核准",
    location: "電腦教室 (一)",
    maxObservers: 20,
    registeredObservers: [],
    lessonPlanUrl: "",
    notes: "教務處已核准，待確定最終研習代碼後發布公告。",
    createdDate: "2025-10-10"
  }
];

// 預設參考流程步驟資料 (依據 1589913_1）辦理公開授課參考流程_V1.pdf)
const PROCESS_STEPS = [
  {
    step: 1,
    title: "流程一：校本計畫與公開授課時間協商",
    desc: "每學年於開學前經共識訂定校本公開授課實施計畫；並經由校內各科(領域)教學研究會協商確認各科(領域)教師公開授課人員及時間。",
    tag: "開學前籌備"
  },
  {
    step: 2,
    title: "流程二：統整彙整、校長核定與校網公告",
    desc: "統整各科公開授課時間，經協調衝堂科別與彙整，陳核校長核定後實施，連同校本公開授課實施計畫，期限內於校網首頁設置公開授課專區進行公告。",
    tag: "教務處彙整"
  },
  {
    step: 3,
    title: "流程三：開放觀課登記與研習系統開設",
    desc: "(1) 校內公開授課行事曆公告後，開放登記觀課，並規劃共同備課事宜及分配觀課教師協助觀察事項。\n(2) 於教師研習系統開設研習。若為區級公開授課，請事先函知各校報名及共同參與相關共備觀議課流程。",
    tag: "觀課報名"
  },
  {
    step: 4,
    title: "流程四：公開授課前製作簡易教學活動設計",
    desc: "公開授課人員於公開授課前完成製作簡易教學活動設計表件內容；可將共同備課會議所提建議事項併入該表件，作為共同備課記錄佐證。",
    tag: "共備與教學設計"
  },
  {
    step: 5,
    title: "流程五：公開授課與現場觀察",
    desc: "公開授課當天，若為區級以上公開授課，可先辦理說課，提供簽到表、教學觀察紀錄表，並留下公開授課影像紀錄。",
    tag: "說課與觀課"
  },
  {
    step: 6,
    title: "流程六：課後專業議課與表件收回",
    desc: "召開課後研議會議進行專業回饋(議課)，留下共同議課紀錄及影像紀錄，並於當日或期限內收回教學觀察紀錄表件及教學省思心得表件(可內含共同議課紀錄)。",
    tag: "專業議課"
  },
  {
    step: 7,
    title: "流程七：行政審核與研習時數核發",
    desc: "由學校行政依據相關表件與紀錄，核實核發研習時數。",
    tag: "時數核發"
  }
];

const BACKUP_REQUIREMENTS = [
  "授課人員：繳交教學活動設計表(可內含共同備課重點要項)及教學省思心得表(可內含議課紀錄及備、觀、議課照片各1張或繳交公開授課現場教學錄影影片)。",
  "觀課教師：繳交教學觀察紀錄表件。",
  "錄影備查：各校亦可因應實際需求與校本公開授課計畫規定，針對授(觀)課進行錄影存檔。",
  "格式自訂：教學活動設計表件、教學觀察紀錄表件、教學省思心得表件，格式由各校自訂。"
];
