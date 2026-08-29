(function (root) {
  "use strict";

  const BANK = Object.freeze([
    { difficulty: "easy", category: "과일", answer: "사과", description: "빨갛거나 초록색이며 아삭하게 먹는 둥근 과일" },
    { difficulty: "easy", category: "과일", answer: "바나나", description: "노란 껍질을 벗겨 먹는 길쭉한 과일" },
    { difficulty: "easy", category: "과일", answer: "딸기", description: "표면에 작은 씨가 박힌 빨간 봄 과일" },
    { difficulty: "easy", category: "과일", answer: "수박", description: "초록 줄무늬 껍질과 붉은 속을 가진 여름 과일" },
    { difficulty: "easy", category: "음식", answer: "떡볶이", description: "매콤달콤한 양념에 떡을 넣어 만드는 분식" },
    { difficulty: "easy", category: "음식", answer: "김밥", description: "김 위에 밥과 여러 재료를 올려 돌돌 만 음식" },
    { difficulty: "easy", category: "음식", answer: "라면", description: "뜨거운 물에 면과 수프를 넣어 끓이는 음식" },
    { difficulty: "easy", category: "음식", answer: "치킨", description: "닭고기를 바삭하게 튀기거나 구운 인기 야식" },
    { difficulty: "easy", category: "음식", answer: "피자", description: "둥근 반죽 위에 치즈와 토핑을 올려 굽는 음식" },
    { difficulty: "easy", category: "음식", answer: "아이스크림", description: "차갑고 달콤하게 얼려 먹는 디저트" },
    { difficulty: "easy", category: "동물", answer: "강아지", description: "사람과 오래 함께 살아온 대표적인 반려동물" },
    { difficulty: "easy", category: "동물", answer: "고양이", description: "수염과 날카로운 발톱을 가진 인기 반려동물" },
    { difficulty: "easy", category: "동물", answer: "토끼", description: "긴 귀와 짧은 꼬리가 특징인 동물" },
    { difficulty: "easy", category: "동물", answer: "기린", description: "아주 긴 목으로 높은 나뭇잎을 먹는 동물" },
    { difficulty: "easy", category: "동물", answer: "코끼리", description: "큰 귀와 긴 코를 가진 육지의 대형 동물" },
    { difficulty: "easy", category: "장소", answer: "학교", description: "학생들이 모여 수업을 듣고 공부하는 곳" },
    { difficulty: "easy", category: "장소", answer: "도서관", description: "많은 책을 읽거나 빌릴 수 있는 조용한 곳" },
    { difficulty: "easy", category: "장소", answer: "놀이터", description: "그네와 미끄럼틀 같은 놀이 기구가 있는 곳" },
    { difficulty: "easy", category: "물건", answer: "우산", description: "비나 햇빛을 막기 위해 머리 위에 펼치는 물건" },
    { difficulty: "easy", category: "탈것", answer: "자전거", description: "두 바퀴를 페달로 굴려 움직이는 탈것" },
    { difficulty: "easy", category: "전자기기", answer: "컴퓨터", description: "프로그램을 실행하고 정보를 처리하는 전자기기" },
    { difficulty: "easy", category: "전자기기", answer: "스마트폰", description: "통화와 인터넷을 손안에서 사용하는 휴대 기기" },
    { difficulty: "easy", category: "전자기기", answer: "텔레비전", description: "영상과 방송을 큰 화면으로 보는 전자기기" },
    { difficulty: "easy", category: "자연", answer: "무지개", description: "비 온 뒤 하늘에 여러 색의 띠로 나타나는 현상" },
    { difficulty: "easy", category: "겨울", answer: "눈사람", description: "눈을 둥글게 뭉쳐 사람 모양으로 만든 것" },
    { difficulty: "easy", category: "기념일", answer: "크리스마스", description: "매년 12월 25일에 기념하는 겨울 축제일" },
    { difficulty: "easy", category: "기념일", answer: "생일파티", description: "태어난 날을 축하하며 여는 모임" },
    { difficulty: "easy", category: "장소", answer: "놀이공원", description: "놀이기구와 공연을 즐길 수 있는 큰 시설" },
    { difficulty: "easy", category: "나라", answer: "대한민국", description: "한반도 남쪽에 위치하며 서울이 수도인 나라" },
    { difficulty: "easy", category: "보안", answer: "비밀번호", description: "본인 확인을 위해 비밀로 정해 두는 문자나 숫자" },
    { difficulty: "normal", category: "동물", answer: "카피바라", description: "물가를 좋아하고 온순한 성격으로 유명한 큰 설치류" },
    { difficulty: "normal", category: "식물", answer: "해바라기", description: "크고 노란 꽃이 태양을 닮은 식물" },
    { difficulty: "normal", category: "식물", answer: "민들레", description: "씨앗이 하얀 솜털이 되어 바람에 날리는 들꽃" },
    { difficulty: "normal", category: "과일", answer: "아보카도", description: "초록색 과육과 커다란 씨를 가진 열대 과일" },
    { difficulty: "normal", category: "디저트", answer: "마카롱", description: "두 개의 둥근 과자 사이에 크림을 넣은 디저트" },
    { difficulty: "normal", category: "음식", answer: "샌드위치", description: "빵 사이에 채소와 고기 등을 넣어 먹는 음식" },
    { difficulty: "normal", category: "장소", answer: "천문대", description: "망원경으로 별과 우주를 관측하는 시설" },
    { difficulty: "normal", category: "물건", answer: "손전등", description: "손에 들고 어두운 곳을 비추는 작은 조명" },
    { difficulty: "normal", category: "전자기기", answer: "이어폰", description: "귀에 꽂아 혼자 소리를 듣는 작은 음향 기기" },
    { difficulty: "normal", category: "시설", answer: "엘리베이터", description: "건물 안에서 사람을 위아래 층으로 옮기는 장치" },
    { difficulty: "normal", category: "시설", answer: "에스컬레이터", description: "계단 모양 발판이 자동으로 움직이는 장치" },
    { difficulty: "normal", category: "교통", answer: "신호등", description: "빨강·노랑·초록 불빛으로 통행을 알려 주는 장치" },
    { difficulty: "normal", category: "교통", answer: "횡단보도", description: "사람이 안전하게 도로를 건너도록 표시한 구역" },
    { difficulty: "normal", category: "놀이기구", answer: "회전목마", description: "말 모형이 음악에 맞춰 둥글게 도는 놀이기구" },
    { difficulty: "normal", category: "놀이기구", answer: "롤러코스터", description: "빠른 속도로 레일을 달리는 놀이기구" },
    { difficulty: "normal", category: "교통", answer: "고속도로", description: "자동차가 빠르게 장거리를 이동하도록 만든 도로" },
    { difficulty: "normal", category: "교통", answer: "지하철", description: "주로 도시의 지하 선로를 달리는 대중교통" },
    { difficulty: "normal", category: "가전", answer: "세탁기", description: "옷을 물과 세제로 자동 세척하는 가전제품" },
    { difficulty: "normal", category: "가전", answer: "전자레인지", description: "음식을 짧은 시간에 데우는 주방 가전" },
    { difficulty: "normal", category: "가전", answer: "공기청정기", description: "실내 먼지와 냄새를 걸러 공기를 깨끗하게 하는 기기" },
    { difficulty: "normal", category: "전자기기", answer: "보조배터리", description: "밖에서 휴대 기기를 충전할 때 쓰는 저장 장치" },
    { difficulty: "normal", category: "컴퓨터", answer: "키보드", description: "글자와 명령을 입력하는 여러 키가 달린 장치" },
    { difficulty: "normal", category: "컴퓨터", answer: "마우스패드", description: "컴퓨터 입력 장치를 부드럽게 움직이도록 받치는 판" },
    { difficulty: "normal", category: "컴퓨터", answer: "스크린샷", description: "화면에 보이는 모습을 그대로 저장한 이미지" },
    { difficulty: "normal", category: "소프트웨어", answer: "업데이트", description: "프로그램을 새로운 버전이나 내용으로 바꾸는 작업" },
    { difficulty: "normal", category: "게임", answer: "튜토리얼", description: "처음 시작한 사람에게 조작과 규칙을 알려 주는 과정" },
    { difficulty: "normal", category: "게임", answer: "체크포인트", description: "실패해도 다시 시작할 수 있도록 저장되는 지점" },
    { difficulty: "normal", category: "게임", answer: "보물상자", description: "귀중한 아이템이나 보상이 들어 있는 상자" },
    { difficulty: "normal", category: "판타지", answer: "마법학교", description: "신비한 주문과 능력을 가르치는 상상의 교육 기관" },
    { difficulty: "normal", category: "상상", answer: "시간여행", description: "현재가 아닌 과거나 미래의 시대로 이동하는 일" },
    { difficulty: "hard", category: "천문", answer: "플라네타륨", description: "둥근 천장에 별과 우주의 모습을 투영하는 시설" },
    { difficulty: "hard", category: "자연", answer: "오로라", description: "극지방 밤하늘에 커튼처럼 나타나는 빛의 현상" },
    { difficulty: "hard", category: "동물", answer: "사막여우", description: "큰 귀로 열을 식히며 건조한 지역에 사는 작은 여우" },
    { difficulty: "hard", category: "동물", answer: "아홀로틀", description: "깃털 같은 외부 아가미가 특징인 멕시코 양서류" },
    { difficulty: "hard", category: "동물", answer: "쿼카", description: "웃는 듯한 표정으로 유명한 호주의 작은 유대류" },
    { difficulty: "hard", category: "식물", answer: "맹그로브", description: "바닷물과 민물이 만나는 습지에서 자라는 숲" },
    { difficulty: "hard", category: "물건", answer: "타임캡슐", description: "현재의 물건이나 기록을 넣어 미래에 여는 용기" },
    { difficulty: "hard", category: "물건", answer: "만화경", description: "거울과 색 조각으로 대칭 무늬를 보여 주는 장난감" },
    { difficulty: "hard", category: "물건", answer: "모래시계", description: "가는 모래가 떨어지는 양으로 시간을 재는 도구" },
    { difficulty: "hard", category: "음악", answer: "오르골", description: "태엽을 감으면 작은 금속 조각이 음악을 연주하는 물건" },
    { difficulty: "hard", category: "의료", answer: "청진기", description: "몸속 심장이나 호흡 소리를 듣는 의료 도구" },
    { difficulty: "hard", category: "도구", answer: "나침반", description: "자기 바늘로 동서남북 방향을 알려 주는 도구" },
    { difficulty: "hard", category: "사진", answer: "파노라마", description: "넓은 풍경을 길게 이어 한 장에 담은 사진 방식" },
    { difficulty: "hard", category: "미술", answer: "실루엣", description: "빛을 등진 대상의 어두운 윤곽만 보이는 모습" },
    { difficulty: "hard", category: "현상", answer: "데자뷔", description: "처음 겪는 일을 전에 경험한 것처럼 느끼는 현상" },
    { difficulty: "hard", category: "초능력", answer: "텔레파시", description: "말이나 행동 없이 생각을 주고받는 상상의 능력" },
    { difficulty: "hard", category: "스포츠", answer: "패러글라이딩", description: "천으로 된 날개를 펴고 높은 곳에서 활공하는 스포츠" },
    { difficulty: "hard", category: "스포츠", answer: "스노클링", description: "호흡관과 물안경을 쓰고 수면 가까이에서 즐기는 활동" },
    { difficulty: "hard", category: "스포츠", answer: "클라이밍", description: "손과 발을 사용해 암벽이나 인공 벽을 오르는 운동" },
    { difficulty: "hard", category: "음악", answer: "오케스트라", description: "여러 종류의 악기가 지휘에 맞춰 함께 연주하는 단체" },
  ]);

  function sample(options = {}) {
    const count = Math.max(1, Math.min(BANK.length, Number(options.count) || 5));
    const random = typeof options.random === "function" ? options.random : Math.random;
    const excluded = new Set((options.excludeAnswers || []).map(String));
    const difficultyPool = options.difficulty && options.difficulty !== "mixed"
      ? BANK.filter((question) => question.difficulty === options.difficulty)
      : BANK.slice();
    let pool = difficultyPool.filter((question) => !excluded.has(question.answer));
    if (pool.length < count) pool = difficultyPool.slice();
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }
    return pool.slice(0, count).map(({ difficulty, ...question }) => ({ ...question, difficulty }));
  }

  root.ChosungQuestionPresets = Object.freeze({ BANK, sample });
})(typeof globalThis !== "undefined" ? globalThis : this);
