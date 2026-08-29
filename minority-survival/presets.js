(function (root) {
  "use strict";

  const BANK = Object.freeze([
    { category: "음식", prompt: "탕수육은 어떻게 먹을까?", optionA: "찍먹", optionB: "부먹" },
    { category: "음식", prompt: "치킨 한 마리에서 먼저 손이 가는 부위는?", optionA: "다리", optionB: "날개" },
    { category: "음식", prompt: "피자 끝부분은?", optionA: "끝까지 먹기", optionB: "남기기" },
    { category: "음식", prompt: "라면에 달걀을 넣는다면?", optionA: "풀어서", optionB: "그대로" },
    { category: "음식", prompt: "민트초코는?", optionA: "호", optionB: "불호" },
    { category: "음식", prompt: "붕어빵은 어디부터 먹을까?", optionA: "머리", optionB: "꼬리" },
    { category: "음식", prompt: "떡볶이와 더 잘 어울리는 것은?", optionA: "순대", optionB: "튀김" },
    { category: "음식", prompt: "아침 식사는?", optionA: "꼭 먹기", optionB: "건너뛰기" },
    { category: "음식", prompt: "카페에서 고른다면?", optionA: "커피", optionB: "달콤한 음료" },
    { category: "음식", prompt: "늦은 밤 배가 고프다면?", optionA: "야식 먹기", optionB: "그냥 자기" },
    { category: "음식", prompt: "달걀 프라이 취향은?", optionA: "반숙", optionB: "완숙" },
    { category: "음식", prompt: "냉면에 식초와 겨자는?", optionA: "넣기", optionB: "안 넣기" },
    { category: "일상", prompt: "아무 일정 없는 주말에는?", optionA: "집에서 쉬기", optionB: "밖으로 나가기" },
    { category: "일상", prompt: "여행 계획은?", optionA: "분 단위 계획", optionB: "가서 정하기" },
    { category: "일상", prompt: "약속 장소에는 보통?", optionA: "미리 도착", optionB: "딱 맞춰 도착" },
    { category: "일상", prompt: "친구와 연락할 때 더 편한 것은?", optionA: "문자", optionB: "전화" },
    { category: "일상", prompt: "긴 휴가가 생긴다면?", optionA: "한곳에 오래", optionB: "여러 곳 이동" },
    { category: "일상", prompt: "비 오는 날 외출은?", optionA: "운치 있다", optionB: "최대한 피한다" },
    { category: "일상", prompt: "집에서 더 포기하기 어려운 것은?", optionA: "침대", optionB: "컴퓨터" },
    { category: "일상", prompt: "물건을 살 때 더 중요한 것은?", optionA: "가격", optionB: "디자인" },
    { category: "일상", prompt: "영화를 볼 때 간식은?", optionA: "필수", optionB: "없어도 된다" },
    { category: "일상", prompt: "책을 고른다면?", optionA: "종이책", optionB: "전자책" },
    { category: "일상", prompt: "청소는 보통?", optionA: "조금씩 자주", optionB: "한 번에 몰아서" },
    { category: "일상", prompt: "잠잘 때 방은?", optionA: "완전히 어둡게", optionB: "작은 불 켜기" },
    { category: "일상", prompt: "좋아하는 노래를 발견하면?", optionA: "한 곡 반복", optionB: "플레이리스트에 추가" },
    { category: "게임", prompt: "파티에서 맡고 싶은 역할은?", optionA: "공격", optionB: "지원" },
    { category: "게임", prompt: "캐릭터를 고를 때 우선하는 것은?", optionA: "외형", optionB: "성능" },
    { category: "게임", prompt: "보상 방식으로 더 끌리는 것은?", optionA: "확정 보상", optionB: "낮은 확률 대박" },
    { category: "게임", prompt: "강한 보스를 만났다면?", optionA: "바로 도전", optionB: "공략부터 확인" },
    { category: "게임", prompt: "장비 강화는?", optionA: "재료 모아 한 번에", optionB: "생길 때마다 바로" },
    { category: "게임", prompt: "게임 중 더 자주 보는 것은?", optionA: "길드 채팅", optionB: "전체 채팅" },
    { category: "게임", prompt: "새 게임을 시작하면?", optionA: "메인 스토리부터", optionB: "맵 구경부터" },
    { category: "게임", prompt: "반복 퀘스트는?", optionA: "매일 꼬박꼬박", optionB: "보상 좋을 때만" },
    { category: "게임", prompt: "게임에서 더 재미있는 것은?", optionA: "협동", optionB: "경쟁" },
    { category: "게임", prompt: "희귀 아이템을 얻으면?", optionA: "바로 사용", optionB: "계속 보관" },
    { category: "게임", prompt: "막히는 구간이 나오면?", optionA: "계속 직접 시도", optionB: "공략 검색" },
    { category: "게임", prompt: "캐릭터 이름은 보통?", optionA: "멋있게", optionB: "웃기게" },
    { category: "게임", prompt: "기간 한정 이벤트는?", optionA: "완주 목표", optionB: "적당히 참여" },
    { category: "상상", prompt: "하나의 능력을 얻는다면?", optionA: "순간이동", optionB: "시간 정지" },
    { category: "상상", prompt: "한 번만 여행할 수 있다면?", optionA: "과거", optionB: "미래" },
    { category: "상상", prompt: "더 갖고 싶은 능력은?", optionA: "투명인간", optionB: "하늘 날기" },
    { category: "상상", prompt: "평생 한곳만 탐험한다면?", optionA: "깊은 바다", optionB: "먼 우주" },
    { category: "상상", prompt: "전설의 동물과 친구가 된다면?", optionA: "용", optionB: "유니콘" },
    { category: "상상", prompt: "보상으로 고른다면?", optionA: "매일 100원", optionB: "오늘만 1만원" },
    { category: "상상", prompt: "특별한 힘을 고른다면?", optionA: "모든 기억 보존", optionB: "10초 뒤 미래 보기" },
    { category: "상상", prompt: "승부에서 더 믿고 싶은 것은?", optionA: "행운", optionB: "실력" },
    { category: "취향", prompt: "평생 살아야 한다면?", optionA: "대도시", optionB: "한적한 시골" },
    { category: "취향", prompt: "하나의 계절만 고른다면?", optionA: "여름", optionB: "겨울" },
    { category: "취향", prompt: "하루 중 더 좋아하는 시간은?", optionA: "이른 아침", optionB: "늦은 밤" },
    { category: "취향", prompt: "무언가를 시작할 때?", optionA: "계획부터", optionB: "일단 시작" },
  ]);

  function categories() {
    return ["음식", "일상", "게임", "상상·취향"];
  }

  function sample(options = {}) {
    const count = Math.max(1, Math.min(BANK.length, Number(options.count) || 5));
    const random = typeof options.random === "function" ? options.random : Math.random;
    const excluded = new Set((options.excludePrompts || []).map(String));
    const categoryPool = options.category && options.category !== "전체"
      ? BANK.filter((question) => options.category === "상상·취향"
        ? question.category === "상상" || question.category === "취향"
        : question.category === options.category)
      : BANK.slice();
    let pool = categoryPool.filter((question) => !excluded.has(question.prompt));
    if (pool.length < count) pool = categoryPool.slice();
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }
    return pool.slice(0, count).map((question) => ({ ...question }));
  }

  root.MinorityQuestionPresets = Object.freeze({ BANK, categories, sample });
})(typeof globalThis !== "undefined" ? globalThis : this);
