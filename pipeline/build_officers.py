"""
「삼한지」 인물 데이터 생성
  1급(실존·핵심)  : 능력치 수기 지정
  2급(실존·기록)  : 역할+격에서 능력치 도출
  3급(가상)       : 시대별 성씨/이름 조합으로 절차 생성
출력: officers.json
"""
import json, random

random.seed(20260815)   # 재현 가능하게 고정

# ══════════════════════════════════════════════════════════
# 1급 — 실존 핵심 인물. 능력치 수기 지정
#   (id, 이름, 세력, 등장, 은퇴, 통솔, 무력, 지력, 정치, 매력, 역할, 성향, 특기, 사료, 설명)
# ══════════════════════════════════════════════════════════
T1 = [
 # ── 고구려 ──
 ("gwanggaeto","광개토대왕","goguryeo",391,412, 98,92,85,88,95,"royal","loyal",["cavalry","forced_march","conquest"],"삼국사기·광개토왕비","재위 22년간 요동과 만주를 아우른 정복군주"),
 ("jangsu","장수왕","goguryeo",413,491, 92,74,90,96,88,"royal","loyal",["governance","diplomacy","siege"],"삼국사기","평양 천도 후 남진을 완성한 장수의 왕"),
 ("eulji","을지문덕","goguryeo",590,618, 96,78,97,82,84,"general","loyal",["flood_attack","scheme","ambush"],"삼국사기","612년 살수에서 수의 대군을 무너뜨림"),
 ("yeongaesomun","연개소문","goguryeo",642,665, 93,90,84,66,72,"general","ambitious",["intimidate","autocracy","defense"],"삼국사기","영류왕을 시해하고 대막리지로 집권"),
 ("ondal","온달","goguryeo",560,590, 82,93,58,45,80,"general","loyal",["duel","valor"],"삼국사기 열전","평강공주 설화의 주인공. 아단성에서 전사"),
 ("myeongnim","명림답부","goguryeo",165,179, 88,72,86,84,76,"general","loyal",["ambush","fortify"],"삼국사기","좌원에서 한의 군대를 청야전술로 격파"),
 ("eulpaso","을파소","goguryeo",191,203, 60,42,92,95,80,"civil","loyal",["governance","relief"],"삼국사기","진대법을 시행한 국상"),
 ("yangmanchun","양만춘","goguryeo",640,650, 94,80,86,74,82,"general","loyal",["siege_defense","fortify"],"통칭(조선후기 문헌)","645년 안시성에서 당 태종의 대군을 막아냄"),
 ("namsaeng","연남생","goguryeo",665,679, 74,70,66,58,50,"general","mercenary",["defect"],"삼국사기·묘지명","연개소문의 장남. 형제 다툼 끝에 당에 투항"),
 ("namgeon","연남건","goguryeo",665,668, 78,80,54,44,48,"general","ambitious",["defense"],"삼국사기","평양성 최후까지 항전한 연개소문의 차남"),
 ("geommojam","검모잠","goguryeo",670,670, 80,74,72,66,78,"general","loyal",["insurgency"],"삼국사기","고구려 부흥운동을 일으킴"),
 ("goyeonmu","고연무","goguryeo",670,673, 82,80,70,58,70,"general","loyal",["insurgency","raid"],"삼국사기","부흥군을 이끌고 신라와 연합"),
 ("changjori","창조리","goguryeo",292,300, 70,58,84,88,74,"civil","ambitious",["governance"],"삼국사기","봉상왕을 폐하고 미천왕을 세운 국상"),
 ("yuyu","유유","goguryeo",244,246, 66,84,74,50,72,"general","loyal",["suicide_attack"],"삼국사기","위군 진영에 거짓 항복해 장수를 찔러 죽임"),
 ("miloo","밀우","goguryeo",244,250, 72,86,62,48,68,"general","loyal",["rearguard"],"삼국사기","동천왕의 퇴각을 몸으로 막아냄"),
 ("wangsanak","왕산악","goguryeo",400,450, 20,15,80,64,86,"artisan","loyal",["music"],"삼국사기","거문고를 만든 악사"),
 ("damjing","담징","goguryeo",590,620, 15,12,84,58,80,"monk","loyal",["craft","culture"],"일본서기","종이·먹 제법과 회화를 왜에 전함"),
 ("dorim","도림","goguryeo",455,475, 40,20,90,72,74,"monk","loyal",["spy","scheme"],"삼국사기","백제에 잠입해 개로왕을 토목에 빠뜨린 첩자승"),

 # ── 후삼국·발해·건국 (고구려 계열) ──
 ("wanggeon","왕건","goguryeo",918,943, 92,80,88,94,96,"royal","loyal",["unify","diplomacy","navy"],"고려사","후삼국을 통일한 고려 태조"),
 ("gungye","궁예","goguryeo",901,918, 86,84,78,58,62,"royal","ambitious",["tyranny","conquest"],"삼국사기","태봉을 세웠으나 폭정으로 축출됨"),
 ("yugeumpil","유금필","goguryeo",920,941, 93,88,82,70,80,"general","loyal",["cavalry","raid","relief"],"고려사","고려 최고의 야전 명장"),
 ("sinsunggyeom","신숭겸","goguryeo",918,927, 82,90,66,58,86,"general","loyal",["last_stand","valor"],"고려사","공산에서 왕건 대신 죽음"),
 ("daejoyeong","대조영","goguryeo",698,719, 90,84,86,88,86,"royal","loyal",["founding","conquest"],"신당서·발해고","발해를 세운 고구려 유민의 지도자"),
 ("jangmunhyu","장문휴","goguryeo",732,733, 84,82,76,60,70,"general","loyal",["navy","raid"],"신당서","발해 수군으로 당의 등주를 기습"),
 ("jumong","주몽","goguryeo",-37,-19, 90,88,84,80,92,"royal","loyal",["founding","archery"],"삼국사기·광개토왕비","고구려의 시조 동명성왕"),
 ("soseono","소서노","baekje",-42,-6, 78,58,86,92,90,"royal","ambitious",["founding","finance"],"삼국사기","주몽을 돕고 온조와 함께 백제를 세운 여걸"),

 # ── 백제 ──
 ("geunchogo","근초고왕","baekje",346,375, 94,85,82,91,90,"royal","loyal",["navy","trade","conquest"],"삼국사기","평양을 쳐 고국원왕을 전사시킨 백제 최전성기의 왕"),
 ("seongwang","성왕","baekje",523,554, 86,70,86,93,88,"royal","loyal",["diplomacy","buddhism","reform"],"삼국사기","사비 천도와 불교 전파. 관산성에서 전사"),
 ("muryeong","무령왕","baekje",501,523, 84,76,82,90,84,"royal","loyal",["governance","recovery"],"삼국사기·지석","웅진기 백제를 다시 일으킴"),
 ("gyebaek","계백","baekje",655,660, 90,94,74,58,86,"general","loyal",["last_stand","valor"],"삼국사기","황산벌에서 5천으로 5만을 맞음"),
 ("seongchung","성충","baekje",641,656, 62,50,90,86,78,"civil","loyal",["remonstrance","strategy"],"삼국사기","옥중에서 탄현 방어를 간언하고 굶어 죽음"),
 ("heungsu","흥수","baekje",641,660, 60,48,88,80,72,"civil","loyal",["strategy"],"삼국사기","유배지에서 백강·탄현 사수를 건의"),
 ("heukchi","흑치상지","baekje",660,689, 90,88,80,68,76,"general","mercenary",["insurgency","cavalry"],"묘지명 출토","부흥군을 이끌다 당에 투항해 명장이 됨"),
 ("boksin","복신","baekje",660,663, 86,78,76,64,74,"general","ambitious",["insurgency"],"삼국사기","백제 부흥운동의 중심. 도침을 죽이고 내분"),
 ("dochim","도침","baekje",660,661, 72,60,80,66,80,"monk","loyal",["insurgency"],"삼국사기","주류성을 근거로 부흥군을 일으킨 승려"),
 ("buyeopung","부여풍","baekje",661,663, 66,58,64,60,72,"royal","loyal",["figurehead"],"삼국사기·일본서기","왜에서 돌아와 부흥군의 왕으로 옹립됨"),
 ("mokrageunja","목라근자","baekje",360,390, 86,82,74,64,70,"general","loyal",["conquest"],"일본서기","가야 방면 원정을 이끈 목씨 가문의 장수"),
 ("mokmanchi","목만치","baekje",420,475, 78,70,76,74,68,"general","ambitious",["politics"],"삼국사기·일본서기","한성 함락기의 실권자"),
 ("sataekjijeok","사택지적","baekje",640,660, 55,45,84,88,74,"civil","loyal",["governance"],"사택지적비 출토","의자왕대의 대좌평. 비문이 전함"),
 ("wangin","왕인","baekje",390,410, 15,12,88,70,82,"civil","loyal",["culture","education"],"일본서기","천자문과 논어를 왜에 전함"),
 ("ajikgi","아직기","baekje",380,400, 18,20,80,66,76,"civil","loyal",["culture"],"일본서기","왜에 학문을 전한 사절"),
 ("noricha","노리사치계","baekje",552,560, 20,15,78,70,80,"civil","loyal",["buddhism"],"일본서기","왜에 불상과 경론을 전함"),
 ("yunchung","윤충","baekje",642,645, 84,82,70,56,66,"general","loyal",["siege"],"삼국사기","642년 대야성을 함락시킴"),
 ("uijik","의직","baekje",647,660, 80,78,68,54,64,"general","loyal",["assault"],"삼국사기","신라 서변을 여러 차례 공격"),
 ("gaero","개로왕","baekje",455,475, 62,58,54,50,60,"royal","loyal",["fortify"],"삼국사기","도림의 계략에 빠져 한성을 잃고 죽음"),

 # ── 후백제 ──
 ("gyeonhwon","견훤","baekje",892,936, 94,90,80,76,78,"royal","ambitious",["conquest","cavalry","siege"],"삼국사기·고려사","후백제를 세운 맹장. 아들에게 유폐됨"),
 ("singeom","신검","baekje",935,936, 74,78,60,54,50,"royal","ambitious",["rebellion"],"삼국사기","견훤을 금산사에 가두고 즉위"),

 # ── 신라 ──
 ("kimyusin","김유신","silla",629,673, 97,89,90,85,92,"general","loyal",["hwarang","unify","cavalry"],"삼국사기 열전","삼국통일 전쟁의 총사령"),
 ("kimchunchu","김춘추","silla",642,661, 72,55,94,98,90,"royal","loyal",["eloquence","tang_diplomacy"],"삼국사기","외교로 당을 끌어들인 태종무열왕"),
 ("munmu","문무왕","silla",661,681, 88,70,90,94,86,"royal","loyal",["unify","navy"],"삼국사기","삼국통일과 나당전쟁을 완수"),
 ("seondeok","선덕여왕","silla",632,647, 70,35,92,95,90,"royal","loyal",["insight","buddhism"],"삼국사기","첨성대와 황룡사 구층탑을 세움"),
 ("jinheung","진흥왕","silla",540,576, 90,74,86,92,88,"royal","loyal",["conquest","hwarang"],"삼국사기·순수비","한강 유역을 장악하고 순수비를 세움"),
 ("isabu","이사부","silla",505,562, 90,82,86,80,78,"general","loyal",["navy","stratagem"],"삼국사기","나무 사자로 우산국을 복속시킴"),
 ("geochilbu","거칠부","silla",545,579, 84,74,86,82,74,"general","loyal",["history","conquest"],"삼국사기","국사를 편찬하고 고구려 10군을 취함"),
 ("sadaham","사다함","silla",562,564, 78,86,70,58,88,"general","loyal",["hwarang","valor"],"삼국사기 열전","15세로 대가야 정벌에 종군한 화랑"),
 ("gwanchang","관창","silla",660,660, 60,80,50,40,88,"general","loyal",["valor","martyr"],"삼국사기 열전","황산벌에서 홀로 돌격해 전사한 소년 화랑"),
 ("kimheumsun","김흠순","silla",655,680, 86,84,74,70,78,"general","loyal",["cavalry"],"삼국사기","김유신의 아우. 백제·고구려 정벌에 종군"),
 ("wonsul","원술","silla",672,680, 74,80,64,54,60,"general","loyal",["redemption"],"삼국사기","석문에서 패해 아버지 김유신에게 버림받음"),
 ("kiminmun","김인문","silla",651,694, 78,72,86,88,82,"royal","loyal",["tang_diplomacy"],"삼국사기","당에 오래 머물며 외교를 담당"),
 ("alcheon","김알천","silla",636,654, 86,84,76,78,74,"general","loyal",["defense"],"삼국사기","비담의 난을 진압한 상대등"),
 ("jukjuk","죽죽","silla",642,642, 66,74,58,46,76,"general","loyal",["last_stand"],"삼국사기 열전","대야성에서 항복을 거부하고 전사"),
 ("pumseok","김품석","silla",640,642, 48,52,40,44,38,"general","loyal",[],"삼국사기","대야성 도독. 실정으로 성을 잃음"),
 ("ichadon","이차돈","silla",527,527, 20,25,70,60,92,"civil","loyal",["martyr","buddhism"],"삼국사기·삼국유사","순교로 불교 공인을 이끌어냄"),
 ("wonhyo","원효","silla",650,686, 15,20,96,70,94,"monk","loyal",["philosophy","popularize"],"삼국유사","일심 사상으로 불교를 민중에 퍼뜨림"),
 ("uisang","의상","silla",661,702, 15,15,92,74,84,"monk","loyal",["philosophy","temple"],"삼국유사","화엄종을 열고 부석사를 세움"),
 ("jajang","자장","silla",636,655, 20,15,86,82,78,"monk","loyal",["buddhism","governance"],"삼국유사","황룡사 구층탑 건립을 건의"),
 ("wongwang","원광","silla",589,630, 25,20,88,78,82,"monk","loyal",["sesok_ogye"],"삼국사기","세속오계를 지어 화랑도의 규범을 세움"),
 ("gangsu","강수","silla",654,692, 15,10,88,80,72,"civil","loyal",["writing","diplomacy"],"삼국사기 열전","외교 문서를 도맡은 문장가"),
 ("bakjesang","박제상","silla",418,418, 60,50,84,76,90,"civil","loyal",["loyalty","rescue"],"삼국사기·삼국유사","왜에 볼모로 간 왕제를 구하고 순사"),
 ("seokuro","석우로","silla",231,253, 80,82,70,62,70,"general","loyal",["raid"],"삼국사기","여러 차례 외적을 물리친 장수"),
 ("bipam","비담","silla",645,647, 70,66,68,72,60,"general","ambitious",["rebellion"],"삼국사기","선덕여왕 말년에 반란을 일으킨 상대등"),

 ("jangbogo","장보고","silla",828,846, 90,82,86,84,88,"general","ambitious",["navy","naval_trade","sea_route"],"삼국사기·신당서","청해진을 근거로 동아시아 해상을 장악"),
 ("choechiwon","최치원","silla",885,908, 22,15,96,80,84,"civil","loyal",["writing","diplomacy"],"삼국사기 열전","당에서 이름을 떨친 대문장가"),
 ("myeongnang","명랑","silla",668,676, 40,20,90,64,80,"monk","loyal",["ritual","navy_defense"],"삼국유사","문두루비법으로 당 수군을 물리쳤다 전함"),

 # ── 가야 ──
 ("suro","김수로","gaya",42,199, 82,74,84,86,92,"royal","loyal",["founding","iron"],"삼국유사 가락국기","금관가야의 시조"),
 ("ureuk","우륵","gaya",520,551, 15,12,78,60,88,"artisan","mercenary",["music"],"삼국사기","가야금 12곡을 짓고 신라에 귀부"),
 ("ijinasi","이진아시","gaya",42,100, 74,70,72,74,78,"royal","loyal",["founding"],"삼국유사·신증동국여지승람","대가야의 시조로 전함"),
 ("doseolji","도설지왕","gaya",550,562, 62,58,60,58,60,"royal","loyal",[],"삼국사기","대가야의 마지막 왕으로 추정"),
]

# ══════════════════════════════════════════════════════════
# 2급 — 사료에 등장하나 기록이 소략한 인물
#   (id, 이름, 세력, 등장, 은퇴, 역할, 격, 성향, 사료, 설명)
#   격: 1=상급 2=중급 3=하급  → 능력치 자동 산출
# ══════════════════════════════════════════════════════════
T2 = [
 # 고구려
 ("bubunno","부분노","goguryeo",-19,10,"general",2,"loyal","삼국사기","주몽을 도와 비류국을 취함"),
 ("oi","오이","goguryeo",-37,-10,"general",2,"loyal","삼국사기","주몽의 건국을 도운 세 벗 중 하나"),
 ("hyeopbo","협보","goguryeo",-37,-10,"general",3,"loyal","삼국사기","주몽의 건국 동반자"),
 ("maori","마리","goguryeo",-37,-10,"general",3,"loyal","삼국사기","주몽의 건국 동반자"),
 ("euldoji","을두지","goguryeo",20,40,"civil",2,"loyal","삼국사기","대무신왕대의 재상"),
 ("songokgu","송옥구","goguryeo",20,40,"civil",2,"loyal","삼국사기","대무신왕에게 계책을 올림"),
 ("goeyu","괴유","goguryeo",22,25,"general",2,"loyal","삼국사기","부여 정벌에서 대소왕을 벰"),
 ("gonojIa","고노자","goguryeo",280,300,"general",2,"loyal","삼국사기","선비의 침입을 막아냄"),
 ("mokdoru","목도루","goguryeo",121,150,"general",3,"loyal","삼국사기","태조왕대의 장수"),
 ("gobokjang","고복장","goguryeo",146,165,"civil",2,"loyal","삼국사기","차대왕에게 직간하다 죽음"),
 ("myeongnimeosu","명림어수","goguryeo",179,200,"civil",2,"loyal","삼국사기","고국천왕대의 국상"),
 ("eulmin","을소","goguryeo",3,20,"civil",3,"loyal","삼국사기","유리왕대의 대보"),
 ("buwiyeom","부위염","goguryeo",-37,-20,"general",3,"loyal","삼국사기","건국기의 장수"),
 ("hwang","황조","goguryeo",300,320,"general",3,"loyal","삼국사기","미천왕대의 장수"),
 ("choebi","최비","goguryeo",319,320,"civil",3,"mercenary","삼국사기","요동에서 고구려에 투항"),
 ("gomu","고무","goguryeo",598,614,"general",2,"loyal","삼국사기","영양왕대의 장수"),
 ("gongeonmu","고건무","goguryeo",612,642,"royal",1,"loyal","삼국사기","영류왕. 연개소문에게 시해됨"),
 ("onsamun","온사문","goguryeo",661,668,"general",2,"loyal","삼국사기","말기의 장수"),
 ("yeonjeongto","연정토","goguryeo",666,668,"general",2,"mercenary","삼국사기","연개소문의 아우. 신라에 투항"),
 ("anseung","안승","goguryeo",670,683,"royal",2,"loyal","삼국사기","보덕국왕으로 신라에 의탁"),
 ("hyeja","혜자","goguryeo",595,615,"monk",2,"loyal","일본서기","쇼토쿠 태자의 스승"),
 ("seungnang","승랑","goguryeo",480,520,"monk",2,"loyal","고승전","삼론학을 정립한 학승"),
 ("bodeok","보덕","goguryeo",650,668,"monk",2,"loyal","삼국유사","도교 숭상에 반발해 백제로 옮김"),
 ("gojeongui","고정의","goguryeo",645,660,"general",3,"loyal","삼국사기","당과의 전쟁기 장수"),

 # 백제
 ("onjo","온조왕","baekje",-18,28,"royal",1,"loyal","삼국사기","백제의 시조"),
 ("biryu","비류","baekje",-18,-18,"royal",3,"loyal","삼국사기","온조의 형. 미추홀에 정착"),
 ("goi","고이왕","baekje",234,286,"royal",1,"loyal","삼국사기","관등제를 정비한 왕"),
 ("chogo","초고왕","baekje",166,214,"royal",2,"loyal","삼국사기","신라와 자주 충돌"),
 ("asin","아신왕","baekje",392,405,"royal",2,"loyal","삼국사기","광개토대왕에게 굴복"),
 ("jeonji","전지왕","baekje",405,420,"royal",2,"loyal","삼국사기","왜에서 돌아와 즉위"),
 ("dongseong","동성왕","baekje",479,501,"royal",2,"ambitious","삼국사기","웅진기의 왕권 회복을 꾀함"),
 ("mu","무왕","baekje",600,641,"royal",1,"loyal","삼국사기","미륵사를 세우고 신라를 압박"),
 ("uija","의자왕","baekje",641,660,"royal",1,"ambitious","삼국사기","해동증자로 불렸으나 말년에 실정"),
 ("buyeoyung","부여융","baekje",660,682,"royal",2,"mercenary","삼국사기·묘지명","의자왕의 아들. 당의 웅진도독"),
 ("jinmu","진무","baekje",392,407,"general",2,"loyal","삼국사기","아신왕대에 고구려와 싸움"),
 ("haegu","해구","baekje",475,478,"general",2,"ambitious","삼국사기","문주왕을 시해한 병관좌평"),
 ("baekga","백가","baekje",498,501,"general",2,"ambitious","삼국사기","동성왕을 시해함"),
 ("yeonsin","연신","baekje",499,501,"general",3,"mercenary","삼국사기","고구려로 달아난 장수"),
 ("sabeopmyeong","사법명","baekje",488,495,"general",2,"loyal","남제서","북위군을 물리쳤다 전함"),
 ("mokhyeopmanna","목협만치","baekje",475,480,"general",2,"loyal","일본서기","한성 함락 때 문주왕을 호위"),
 ("jomiggeon","조미걸취","baekje",475,480,"general",3,"loyal","일본서기","웅진 천도를 도움"),
 ("yeoneun","은상","baekje",645,649,"general",2,"loyal","삼국사기","신라 석토성 등을 공격"),
 ("gwalleuk","관륵","baekje",602,620,"monk",2,"loyal","일본서기","역법과 천문을 왜에 전함"),
 ("ajwa","아좌태자","baekje",597,600,"royal",3,"loyal","일본서기","왜에 건너가 활동"),
 ("gyeomik","겸익","baekje",526,540,"monk",2,"loyal","미륵불광사사적","인도에서 율장을 구해옴"),
 ("mucchan","무광왕","baekje",600,640,"royal",3,"loyal","관세음응험기","익산 천도설과 관련"),
 ("jindoun","진도","baekje",396,400,"general",3,"loyal","삼국사기","아신왕대 장수"),
 ("yeoseoni","여신","baekje",405,427,"civil",2,"loyal","삼국사기","전지왕대의 상좌평"),
 ("guisil","귀실복신","baekje",660,663,"general",1,"ambitious","일본서기","복신의 다른 표기. 부흥군 지도자"),

 # 신라
 ("hyeokgeose","박혁거세","silla",-57,4,"royal",1,"loyal","삼국사기","신라의 시조"),
 ("talhae","석탈해","silla",57,80,"royal",2,"loyal","삼국사기","석씨 왕조의 시조"),
 ("kimalji","김알지","silla",65,100,"royal",2,"loyal","삼국사기","경주 김씨의 시조"),
 ("naemul","내물왕","silla",356,402,"royal",1,"loyal","삼국사기","김씨 왕위 세습을 확립"),
 ("nulji","눌지왕","silla",417,458,"royal",2,"loyal","삼국사기","고구려의 간섭에서 벗어남"),
 ("jijeung","지증왕","silla",500,514,"royal",1,"loyal","삼국사기","국호와 왕호를 정하고 우산국을 복속"),
 ("beopheung","법흥왕","silla",514,540,"royal",1,"loyal","삼국사기","율령 반포와 불교 공인"),
 ("jinpyeong","진평왕","silla",579,632,"royal",2,"loyal","삼국사기","오랜 재위 동안 백제와 대치"),
 ("jindeok","진덕여왕","silla",647,654,"royal",2,"loyal","삼국사기","당과의 관계를 다짐"),
 ("sinmun","신문왕","silla",681,692,"royal",2,"loyal","삼국사기","통일 후 체제를 정비"),
 ("kimseoheon","김서현","silla",595,630,"general",2,"loyal","삼국사기","김유신의 아버지"),
 ("kimmuryeok","김무력","silla",550,570,"general",2,"loyal","삼국사기·순수비","관산성에서 성왕을 잡음. 김유신의 조부"),
 ("kimyangdo","김양도","silla",660,670,"general",2,"loyal","삼국사기","당에 사신으로 오가다 옥사"),
 ("pilbu","필부","silla",660,660,"general",3,"loyal","삼국사기 열전","칠중성을 지키다 전사"),
 ("nulchoe","눌최","silla",624,624,"general",3,"loyal","삼국사기 열전","속함성에서 끝까지 항전"),
 ("sona","소나","silla",675,675,"general",3,"loyal","삼국사기 열전","아달성에서 말갈과 싸우다 전사"),
 ("chwido","취도","silla",670,684,"general",3,"loyal","삼국사기 열전","형제가 대를 이어 전사"),
 ("kimyeongyun","김영윤","silla",684,684,"general",3,"loyal","삼국사기 열전","보덕국의 난에서 전사"),
 ("geomgun","검군","silla",627,628,"civil",3,"loyal","삼국사기 열전","부정을 거부하다 독살됨"),
 ("kimpumil","김품일","silla",655,670,"general",2,"loyal","삼국사기","관창의 아버지. 여러 전투에 종군"),
 ("mulgyeja","물계자","silla",209,220,"general",3,"loyal","삼국사기 열전","포상팔국 전투의 공을 사양"),
 ("baekgyeol","백결선생","silla",450,480,"artisan",3,"loyal","삼국사기 열전","방아타령을 지은 가난한 악사"),
 ("solgeo","솔거","silla",700,750,"artisan",2,"loyal","삼국사기","황룡사 벽에 소나무를 그린 화가"),
 ("seolchong","설총","silla",680,720,"civil",1,"loyal","삼국사기","이두를 정리한 원효의 아들"),
 ("hyecheol","혜량","silla",551,570,"monk",2,"mercenary","삼국사기","고구려에서 신라로 귀부한 승려"),
 ("kimdaemun","김대문","silla",700,720,"civil",2,"loyal","삼국사기","화랑세기를 지음"),
 ("bisumun","비형랑","silla",580,600,"general",3,"loyal","삼국유사","진지왕의 아들로 전하는 설화적 인물"),
 ("yeomjang","염장","silla",647,650,"general",3,"loyal","삼국사기","비담의 난 진압에 참여"),
 ("jukji","죽지","silla",649,690,"general",2,"loyal","삼국사기","여러 전투에 종군한 화랑 출신 장수"),
 ("chinchun","진춘","silla",660,670,"general",3,"loyal","삼국사기","백제 정벌에 종군"),

 # 가야
 ("heohwangok","허황옥","gaya",48,189,"royal",2,"loyal","삼국유사 가락국기","김수로의 왕비로 전함"),
 ("gyeongdeung","김구해","gaya",521,532,"royal",2,"mercenary","삼국사기","금관가야 마지막 왕. 신라에 항복"),
 ("hajiwang","하지왕","gaya",479,490,"royal",2,"loyal","남제서","남제에 사신을 보낸 대가야 왕"),
 ("wolgwang","월광태자","gaya",550,562,"royal",3,"loyal","신증동국여지승람","대가야 왕자로 전함"),
 ("taljigijeun","탈지이질금","gaya",532,540,"royal",3,"loyal","삼국사기","금관가야 왕족"),
 # ══ 후삼국 — 고려·태봉 (고구려 계열) ══
 ("bokjigyeom","복지겸","goguryeo",918,930,"general",2,"loyal","고려사","왕건을 추대한 사기장(四騎將)의 하나"),
 ("baehyeongyeong","배현경","goguryeo",918,936,"general",2,"loyal","고려사","기장 출신으로 왕건 추대에 앞장섬"),
 ("hongyu","홍유","goguryeo",918,936,"general",2,"loyal","고려사","왕건 추대 사기장의 하나"),
 ("baksulhui","박술희","goguryeo",921,945,"general",2,"loyal","고려사","혜종을 보호한 무장"),
 ("choeeung","최응","goguryeo",918,932,"civil",2,"loyal","고려사","궁예·왕건을 섬긴 문신"),
 ("wangsikryeom","왕식렴","goguryeo",930,949,"general",2,"loyal","고려사","서경을 지킨 왕실 종친"),
 ("kimrak","김락","goguryeo",918,927,"general",2,"loyal","고려사","공산에서 신숭겸과 함께 전사"),
 ("jonggan","종간","goguryeo",905,918,"civil",2,"ambitious","삼국사기","궁예의 측근"),
 ("eunbu","은부","goguryeo",905,918,"general",3,"ambitious","삼국사기","궁예의 심복"),
 ("neungsan","능산","goguryeo",918,930,"general",3,"loyal","고려사","고려 초의 장수"),
 ("yugeungdal","유긍달","goguryeo",918,930,"civil",3,"loyal","고려사","충주 호족"),
 # ══ 발해 ══
 ("daemuye","대무예","goguryeo",719,737,"royal",1,"ambitious","신당서","발해 무왕. 당을 선제 공격"),
 ("daeheummu","대흠무","goguryeo",737,793,"royal",2,"loyal","신당서","발해 문왕. 제도를 정비"),
 ("daemunye","대문예","goguryeo",719,730,"general",2,"mercenary","신당서","무왕의 아우. 당에 망명"),
 # ══ 후백제 ══
 ("yanggeom","양검","baekje",935,936,"royal",2,"ambitious","삼국사기","견훤의 아들. 신검의 거사에 가담"),
 ("yonggeom","용검","baekje",935,936,"royal",3,"ambitious","삼국사기","견훤의 아들"),
 ("geumgang","금강","baekje",930,935,"royal",2,"loyal","삼국사기","견훤이 후계로 삼으려 한 아들"),
 ("neunghwan","능환","baekje",920,936,"civil",2,"ambitious","삼국사기","후백제의 재상. 신검을 옹립"),
 ("chuheojo","추허조","baekje",920,936,"general",2,"loyal","삼국사기","후백제의 장수"),
 ("kimchong","김총","baekje",900,930,"general",2,"loyal","삼국사기","견훤을 도운 순천 호족"),
 ("ajagae","아자개","baekje",885,918,"general",2,"ambitious","삼국사기","상주의 호족. 견훤의 아버지로 전함"),
 ("sindeok","신덕","baekje",920,936,"general",3,"loyal","삼국사기","후백제 장수"),
 ("sanggwi","상귀","baekje",930,936,"general",3,"loyal","고려사","예성강을 습격한 후백제 수군장"),
 ("choeseungwu","최승우","baekje",900,930,"civil",2,"loyal","삼국사기","견훤의 격서를 지은 문객"),
 # ══ 신라 말 ══
 ("gyeongsun","경순왕","silla",927,935,"royal",2,"loyal","삼국사기","고려에 나라를 넘긴 신라 마지막 왕"),
 ("jeongnyeon","정년","silla",828,846,"general",2,"loyal","삼국사기 열전","장보고의 동료 무장"),
 ("kimyang","김양","silla",836,857,"general",2,"loyal","삼국사기 열전","신무왕을 옹립한 장수"),
 ("kimheonchang","김헌창","silla",807,822,"general",2,"ambitious","삼국사기","웅천주에서 반란을 일으킴"),
 ("wonjong","원종","silla",889,890,"general",3,"ambitious","삼국사기","사벌주에서 봉기"),
 ("aeno","애노","silla",889,890,"general",3,"ambitious","삼국사기","원종과 함께 봉기"),
 ("bakyeonggyu","박영규","silla",930,940,"civil",3,"mercenary","고려사","승주 호족. 고려에 귀부"),
 # ══ 건국 신화·설화 (고구려) ══
 ("haemosu","해모수","goguryeo",-59,-40,"royal",2,"loyal","삼국유사(설화)","천제의 아들로 전하는 북부여의 시조"),
 ("yuhwa","유화부인","goguryeo",-58,-24,"royal",3,"loyal","삼국유사(설화)","주몽의 어머니"),
 ("geumwa","금와왕","goguryeo",-48,-24,"royal",2,"loyal","삼국사기(설화)","동부여의 왕. 주몽을 거두어 기름"),
 ("daeso","대소","goguryeo",-24,22,"royal",2,"ambitious","삼국사기","동부여 왕. 대무신왕에게 죽음"),
 ("yuriwang","유리왕","goguryeo",-19,18,"royal",2,"loyal","삼국사기","황조가를 지은 고구려 2대 왕"),
 ("hodong","호동왕자","goguryeo",32,32,"royal",3,"loyal","삼국사기(설화)","낙랑공주 설화의 주인공"),
 ("nakrang","낙랑공주","goguryeo",32,32,"royal",3,"loyal","삼국사기(설화)","자명고를 찢고 죽음"),
 ("pyeonggang","평강공주","goguryeo",560,590,"royal",2,"loyal","삼국사기 열전","온달을 장수로 키움"),
 ("micheon","미천왕","goguryeo",300,331,"royal",1,"loyal","삼국사기","소금장수로 숨어 지내다 즉위"),
 # ══ 설화 (백제) ══
 ("domi","도미","baekje",455,475,"civil",3,"loyal","삼국사기 열전(설화)","개로왕에게 눈을 잃은 인물"),
 ("domibuin","도미부인","baekje",455,475,"civil",3,"loyal","삼국사기 열전(설화)","정절로 이름을 남김"),
 ("seonhwa","선화공주","baekje",600,630,"royal",2,"loyal","삼국유사(설화)","서동요 설화의 주인공"),
 ("asadal","아사달","baekje",750,760,"artisan",2,"loyal","설화","석가탑을 만든 석공"),
 ("asanyeo","아사녀","baekje",750,760,"civil",3,"loyal","설화","아사달의 아내. 무영탑 전설"),
 # ══ 설화 (신라) ══
 ("alyeong","알영부인","silla",-53,-4,"royal",3,"loyal","삼국사기(설화)","박혁거세의 왕비"),
 ("cheoyong","처용","silla",879,890,"civil",3,"loyal","삼국유사(설화)","처용가와 처용무의 주인공"),
 ("suro_buin","수로부인","silla",702,737,"royal",3,"loyal","삼국유사(설화)","헌화가 설화의 주인공"),
 ("kimdaeseong","김대성","silla",745,774,"civil",2,"loyal","삼국유사","불국사와 석굴암을 세움"),
 ("yeono","연오랑","silla",157,160,"artisan",3,"loyal","삼국유사(설화)","해와 달의 정기로 전함"),
 ("seo_o","세오녀","silla",157,160,"artisan",3,"loyal","삼국유사(설화)","연오랑의 아내"),
 ("geotaji","거타지","silla",888,895,"general",3,"loyal","삼국유사(설화)","활로 요괴를 물리친 무사"),
 ("jigwi","지귀","silla",632,647,"civil",3,"loyal","설화","선덕여왕을 사모하다 불귀신이 됨"),
 ("sonsun","손순","silla",826,836,"civil",3,"loyal","삼국유사(설화)","효행으로 이름을 남김"),
 ("dohwanyeo","도화녀","silla",576,600,"civil",3,"loyal","삼국유사(설화)","비형랑의 어머니"),
 ("cheongwannyeo","천관녀","silla",610,630,"artisan",3,"loyal","설화","김유신 설화에 등장"),
 ("hyetong","혜통","silla",665,690,"monk",2,"loyal","삼국유사","주술로 이름난 승려"),
 ("jinpyo","진표","silla",750,780,"monk",2,"loyal","삼국유사","점찰법회를 연 율사"),
 ("yangji","양지","silla",630,660,"artisan",2,"loyal","삼국유사","석장사의 조각승"),
 ("sabok","사복","silla",650,670,"monk",3,"loyal","삼국유사(설화)","원효와 얽힌 설화의 인물"),
 ("nohilbudeuk","노힐부득","silla",700,720,"monk",3,"loyal","삼국유사(설화)","달달박박과 함께 성불"),
 ("daldalbakbak","달달박박","silla",700,720,"monk",3,"loyal","삼국유사(설화)","노힐부득과 함께 수도"),
 ("ukmyeon","욱면","silla",755,765,"civil",3,"loyal","삼국유사(설화)","염불로 승천했다 전함"),
 ("kimhyeon","김현","silla",790,800,"civil",3,"loyal","삼국유사(설화)","호랑이 처녀 설화의 주인공"),
 # ══ 가야 보강 ══
 ("jeonggyeonmoju","정견모주","gaya",42,80,"royal",2,"loyal","신증동국여지승람(설화)","대가야·금관가야 시조의 어머니로 전함"),
 ("noejilcheongye","뇌질청예","gaya",42,90,"royal",3,"loyal","설화","금관가야 시조 설화의 이름"),
 ("gyego","계고","gaya",551,570,"artisan",3,"mercenary","삼국사기","우륵에게 가야금을 배움"),
 ("beopji","법지","gaya",551,570,"artisan",3,"mercenary","삼국사기","우륵의 제자"),
 ("mandeok","만덕","gaya",551,570,"artisan",3,"mercenary","삼국사기","우륵의 제자"),
 ("gyeomji","겸지왕","gaya",492,521,"royal",3,"loyal","삼국유사","금관가야의 왕"),
 ("jilji","질지왕","gaya",451,492,"royal",3,"loyal","삼국유사","금관가야의 왕"),
 ("isipum","이시품왕","gaya",346,407,"royal",3,"loyal","삼국유사","금관가야의 왕"),
 ("chwihui","취희왕","gaya",421,451,"royal",3,"loyal","삼국유사","금관가야의 왕"),
]

# ══════════════════════════════════════════════════════════
# 3급 — 가상 인물. 시대·세력별 실제 성씨 구조로 생성
# ══════════════════════════════════════════════════════════
SURNAME = {
    # 고구려: 왕족 고씨 + 5부 및 사서 등장 성씨
    "goguryeo": ["고","을","명림","연","해","송","목","우","주","창","극","optional",
                 "대","소","방","온","보","상","다","환"],
    # 백제: 대성팔족(사·연·해·진·목·백·협·국) + 왕성 부여
    "baekje":   ["사택","연","해","진","목","백","협","국","부여","사","목협","마","조미","은"],
    # 신라: 왕성 3성 + 6부 성씨
    "silla":    ["김","박","석","이","최","손","정","배","설","알","거","죽","취"],
    # 가야: 김·이 계열 + 지역명 기반
    "gaya":     ["김","이","도","아","탈","월","하","단"],
}
SURNAME["goguryeo"] = [s for s in SURNAME["goguryeo"] if s != "optional"]

# 왕명과 유명인의 전체 이름은 제외하고, 이름 구성 요소만 모음
GIVEN = {
 "goguryeo": ["문덕","자유","도루","노자","복장","어수","두지","옥구","분노","위염",
              "사문","정토","연수","남무","발기","계수","돌고","보연","평성","우태",
              "노","무골","묵거","재사","마루","호개","상루","음우","시원","현","추발",
              "수성","비류","막근","막덕","을음","해우","송양","다우","환권"],
 "baekje":   ["근수","지적","만치","근자","상지","걸취","법명","도","신","구",
              "가","충","수","직","윤충","의직","은상","진도","여신","무광",
              "다루","우수","형","선","등","술","맹","광","동","현","길","염",
              "가루","곤","연","막고","차","동성","연회","우복"],
 "silla":    ["유신","알천","흠순","양도","품일","무력","서현","제상","우로","계자",
              "대문","영윤","죽지","염장","진춘","관창","원술","필부","눌최","소나",
              "취도","검군","거도","이사","실직","용춘","서불","술종","반굴","비녕",
              "취항","눌지","호림","백운","보종","문노","미실","설원","하종","염종"],
 "gaya":     ["설지","광","지","해","무","달","산","벌","질금","월광",
              "이나","도설","아라","비지","가실","다","라","실","구형","노종",
              "청예","거칠","우","연","사물","고순","탈","혜","수","진"],
}

# ══════════════════════════════════════════════════════════
# 압축 시나리오 — 700년의 삼국시대를 50년으로 접어 전원을 공존시킴
#   코에이 삼국지가 꽉 찬 이유는 184~234년 50년 안에 인물이 몰려 있기 때문.
#   역사 연도를 그대로 쓰면 특정 시점에 20명밖에 안 남는다.
#   → histAppear/histRetire(고증)는 보존하고, age/lifespan(압축)을 따로 둔다.
# ══════════════════════════════════════════════════════════
CAMPAIGN_YEARS = 50

# 개국 군주 — 각 세력의 시작 군주 1인
RULERS = {"goguryeo":"gwanggaeto", "baekje":"geunchogo",
          "silla":"jinheung", "gaya":"suro"}

# 시작 나이 수기 지정 — 가문 관계와 서사가 걸린 인물
AGE_FIX = {
    # 군주 — 전성기 초입
    "gwanggaeto":29, "geunchogo":38, "jinheung":33, "suro":44,
    # 김씨 3대 (조부-부-본인). 김유신은 젊게 시작해 대성하도록
    "kimmuryeok":61, "kimseoheon":44, "kimyusin":22, "wonsul":-6,
    # 연씨 부자
    "yeongaesomun":41, "namsaeng":17, "namgeon":15,
    # 광개토-장수 부자
    "jangsu":11,
    # 요절한 소년 영웅 — 어리게 두어 성장의 여지를 줌
    "gwanchang":15, "sadaham":15, "ondal":24, "jukjuk":19,
    # 백전노장·원로
    "eulpaso":57, "myeongnim":59, "eulji":46, "isabu":48,
    "seongchung":52, "heungsu":50, "changjori":58, "geochilbu":45,
    # 외교·문사
    "kimchunchu":31, "kiminmun":20, "gangsu":26, "seolchong":18,
    # 승려 — 사상적 원숙기
    "wonhyo":34, "uisang":30, "jajang":42, "wongwang":48, "dorim":50,
    # 백제 무장
    "gyebaek":36, "heukchi":28, "boksin":33, "yunchung":39,
    # 문무왕은 김춘추의 아들
    "munmu":8,
}

def assign_age(o, rnd):
    """압축 시나리오용 시작 나이. 음수는 아직 태어나지 않음(캠페인 중 등장)."""
    if o["id"] in AGE_FIX:
        return AGE_FIX[o["id"]]
    r = o["role"]; t = o["tier"]
    if t == 1:      lo, hi = 24, 48     # 핵심 인물은 대체로 전성기
    elif t == 2:    lo, hi = 18, 52
    else:           lo, hi = 16, 46
    if r == "monk":    lo, hi = lo + 8, hi + 6
    if r == "royal":   lo, hi = lo + 4, hi
    if r == "artisan": lo, hi = lo + 6, hi + 4
    age = int(rnd.triangular(lo, hi, (lo + hi) / 2 - 4))
    # 차세대 층 — 캠페인 중·후반에 성인이 되어 등장한다.
    # (이게 얇으면 40년차부터 인물이 말라 게임이 빈다)
    if t == 3 and rnd.random() < 0.34:
        age = rnd.randint(-18, 14)
    elif t == 2 and rnd.random() < 0.12:
        age = rnd.randint(-6, 14)
    return age

def assign_lifespan(o, age, rnd):
    """수명. 요절한 인물은 그 서사를 살려 짧게."""
    SHORT = {"gwanchang","sadaham","ichadon","jukjuk","bakjesang","yuyu",
             "dochim","pilbu","nulchoe","sona","geomgun","kimyeongyun"}
    base = 71 if o["tier"] == 1 else 67
    if o["role"] in ("monk","civil","artisan"): base += 6
    ls = int(rnd.gauss(base, 9))
    if o["id"] in SHORT:
        ls = max(age + rnd.randint(4, 16), 22)
    return max(age + 6, min(88, ls))

ROLE_W = [("general",0.52),("civil",0.26),("royal",0.10),("monk",0.07),("artisan",0.05)]
LOYAL_W = [("loyal",0.62),("ambitious",0.24),("mercenary",0.14)]

# 역할별 능력치 중심값 (통솔, 무력, 지력, 정치, 매력)
ROLE_BASE = {
 "general": (72, 74, 56, 50, 58),
 "civil":   (44, 38, 74, 76, 60),
 "royal":   (66, 58, 68, 74, 70),
 "monk":    (28, 24, 78, 62, 72),
 "artisan": (26, 26, 66, 52, 66),
}
# 격에 따른 가감
GRADE_ADJ = {1: +11, 2: 0, 3: -13}

SKILL_POOL = {
 "general": ["cavalry","archery","siege","siege_defense","ambush","forced_march",
             "fortify","raid","navy","valor","rearguard","spear"],
 "civil":   ["governance","relief","diplomacy","strategy","remonstrance","writing",
             "finance","law","census"],
 "royal":   ["governance","diplomacy","conquest","buddhism","reform","insight"],
 "monk":    ["buddhism","philosophy","medicine","culture","temple"],
 "artisan": ["music","craft","painting","architecture","ironwork"],
}

def clamp(v, lo=8, hi=99): return max(lo, min(hi, int(round(v))))

# 등급별 능력치 상한 — 수기 지정한 1급이 항상 정점에 서도록
TIER_CAP = {2: 88, 3: 80}

def make_stats(role, grade, rnd, tier):
    base = ROLE_BASE[role]; adj = GRADE_ADJ[grade]
    cap = TIER_CAP[tier]
    out = {}
    for key, b in zip(("lead","war","int","pol","chr"), base):
        out[key] = clamp(b + adj + rnd.gauss(0, 7), 8, cap)
    return out

def pick(weights, rnd):
    r = rnd.random(); acc = 0
    for name, w in weights:
        acc += w
        if r <= acc: return name
    return weights[-1][0]

# ── 조립 ──
officers = []
used_names, used_ids = set(), set()

for (oid,name,fac,ap,rt,lead,war,intel,pol,chr_,role,loy,skills,src,note) in T1:
    officers.append({
        "id": oid, "name": name, "faction": fac, "tier": 1,
        "histAppear": ap, "histRetire": rt, "role": role,
        "stats": {"lead":lead,"war":war,"int":intel,"pol":pol,"chr":chr_},
        "skills": skills, "loyalty": loy, "source": src, "note": note,
    })
    used_names.add(name); used_ids.add(oid)

rnd = random.Random(20260815)
for (oid,name,fac,ap,rt,role,grade,loy,src,note) in T2:
    st = make_stats(role, grade, rnd, 2)
    pool = SKILL_POOL[role]
    n = 2 if grade == 1 else 1
    officers.append({
        "id": oid, "name": name, "faction": fac, "tier": 2,
        "histAppear": ap, "histRetire": rt, "role": role,
        "stats": st, "skills": rnd.sample(pool, n),
        "loyalty": loy, "source": src, "note": note,
    })
    used_names.add(name); used_ids.add(oid)

# 3급 가상 인물로 300명 채우기
TARGET = 300

# 가상 인물 배분 — 압축 시나리오에서는 전원이 공존하므로
# 시나리오별 할당이 아니라 세력별 총량만 맞춘다.
# 실존·설화 인물이 늘어난 만큼 가상 인물은 줄어든다.
# 세력별 목표 비중에서 이미 확보한 인원을 뺀 만큼만 생성.
QUOTA = {"goguryeo": 0.30, "baekje": 0.26, "silla": 0.29, "gaya": 0.15}
FILL = {}
for _f, _r in QUOTA.items():
    _have = sum(1 for o in officers if o["faction"] == _f)
    FILL[_f] = max(0, round(TARGET * _r) - _have)
_gap = TARGET - len(officers) - sum(FILL.values())
if _gap:                       # 반올림 오차는 가장 큰 세력에 흡수
    FILL[max(FILL, key=FILL.get)] += _gap
print("가상 인물 보충:", FILL, "합계", sum(FILL.values()))

fic_idx = 0
for fac, count in FILL.items():
    made = 0; guard = 0
    while made < count and guard < 4000:
        guard += 1
        sn = rnd.choice(SURNAME[fac]); gn = rnd.choice(GIVEN[fac])
        name = sn + gn
        if name in used_names:
            continue
        role = pick(ROLE_W, rnd)
        grade = rnd.choices([1, 2, 3], weights=[0.08, 0.42, 0.50])[0]
        fic_idx += 1
        oid = f"fic_{fac[:2]}_{fic_idx:03d}"
        pool = SKILL_POOL[role]
        officers.append({
            "id": oid, "name": name, "faction": fac, "tier": 3,
            "histAppear": None, "histRetire": None, "role": role,
            "stats": make_stats(role, grade, rnd, 3),
            "skills": rnd.sample(pool, 1 if grade > 1 else 2),
            "loyalty": pick(LOYAL_W, rnd),
            "source": "가상", "note": "",
        })
        used_names.add(name); used_ids.add(oid)
        made += 1
    if made < count:
        print(f"  경고: {fac} — 이름 조합 부족 {made}/{count}")

# ── 압축 시나리오 필드 부여 ──
for o in officers:
    o["age"] = assign_age(o, rnd)
    o["lifespan"] = assign_lifespan(o, o["age"], rnd)
    o["ruler"] = (RULERS.get(o["faction"]) == o["id"])

officers.sort(key=lambda o: (o["tier"], o["faction"], -max(o["stats"].values())))
json.dump(officers, open("officers.json","w"), ensure_ascii=False, indent=1)

# ── 리포트 ──
from collections import Counter
print(f"총 {len(officers)}명")
print("등급:", dict(sorted(Counter(o['tier'] for o in officers).items())))
print("세력:", dict(Counter(o['faction'] for o in officers)))
print("역할:", dict(Counter(o['role'] for o in officers)))
print("성향:", dict(Counter(o['loyalty'] for o in officers)))
print("\n능력치 분포(전체 평균):")
for k in ("lead","war","int","pol","chr"):
    vs = [o['stats'][k] for o in officers]
    print(f"  {k:5} 평균 {sum(vs)/len(vs):5.1f}  최고 {max(vs)}  최저 {min(vs)}")
print("\n종합능력 상위 12명:")
for o in sorted(officers, key=lambda o: -sum(o['stats'].values()))[:12]:
    s = o['stats']
    print(f"  {o['name']:<8} {o['faction']:<9} 합{sum(s.values()):4}  "
          f"통{s['lead']:3} 무{s['war']:3} 지{s['int']:3} 정{s['pol']:3} 매{s['chr']:3}")
assert len({o['id'] for o in officers}) == len(officers), "id 중복"
assert len({o['name'] for o in officers}) == len(officers), "이름 중복"
print("\n무결성 검사 통과 (id·이름 중복 없음)")
