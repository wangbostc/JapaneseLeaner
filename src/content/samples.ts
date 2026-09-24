import type { Sentence } from '../lib/db'

/** Starter lessons, written for this app. Voiced by the device's Japanese TTS. */
interface Sample {
  title: string
  level: string
  lines: [ja: string, en: string, zh: string][]
}

const SAMPLES: Sample[] = [
  {
    title: '私の朝',
    level: 'N5',
    lines: [
      ['私は毎朝六時に起きます。', 'I get up at six every morning.', '我每天早上六点起床。'],
      ['まず、窓を開けて、コーヒーを飲みます。', 'First, I open the window and drink coffee.', '首先，我打开窗户，喝咖啡。'],
      ['朝ごはんはパンと卵です。', 'Breakfast is bread and eggs.', '早饭是面包和鸡蛋。'],
      ['七時半に家を出て、駅まで歩きます。', 'At seven thirty I leave home and walk to the station.', '七点半出门，走到车站。'],
      ['電車の中で、日本語のポッドキャストを聞きます。', 'On the train, I listen to a Japanese podcast.', '在电车上，我听日语播客。'],
      ['短い時間ですが、毎日続けています。', "It's only a short time, but I keep it up every day.", '虽然时间很短，但我每天都在坚持。'],
    ],
  },
  {
    title: '週末のカフェ',
    level: 'N4',
    lines: [
      ['先週の土曜日、友達と新しいカフェに行きました。', 'Last Saturday I went to a new café with a friend.', '上周六，我和朋友去了一家新开的咖啡馆。'],
      ['駅から少し遠かったけど、店はとても静かでした。', 'It was a little far from the station, but the café was very quiet.', '虽然离车站有点远，但店里很安静。'],
      ['私は抹茶ラテを、友達はチーズケーキを頼みました。', 'I ordered a matcha latte, and my friend ordered cheesecake.', '我点了抹茶拿铁，朋友点了芝士蛋糕。'],
      ['店員さんが「ごゆっくりどうぞ」と言ってくれました。', 'The server told us, "Please take your time."', '店员对我们说："请慢用。"'],
      ['気がついたら、三時間も話していました。', 'Before we knew it, we had been talking for three hours.', '不知不觉，我们聊了整整三个小时。'],
      ['来月また行こうと約束しました。', 'We promised to go again next month.', '我们约好下个月再去。'],
    ],
  },
  {
    title: '雨の日の過ごし方',
    level: 'N3',
    lines: [
      ['梅雨の時期になると、外に出るのが面倒になります。', 'When the rainy season comes, going out becomes a chore.', '一到梅雨季节，出门就变得很麻烦。'],
      ['でも、雨の日には雨の日なりの楽しみ方があると思います。', 'But I think rainy days have their own kind of fun.', '不过我觉得，雨天也有雨天的乐趣。'],
      ['例えば、ずっと読みたかった本を一気に読んだり、部屋を片付けたりします。', "For example, I read a book I've long wanted to read in one sitting, or tidy my room.", '比如，一口气读完一直想读的书，或者收拾房间。'],
      ['窓の外の雨の音を聞きながら料理をするのも、意外と落ち着きます。', 'Cooking while listening to the rain outside is surprisingly calming, too.', '一边听着窗外的雨声一边做饭，也意外地让人平静。'],
      ['天気に気分を左右されないように、自分なりの過ごし方を見つけておくといいでしょう。', "It's worth finding your own way to spend the day, so the weather doesn't decide your mood.", '为了不让天气左右心情，最好找到属于自己的度过方式。'],
    ],
  },
]

export const sampleLessons = () =>
  SAMPLES.map((s) => ({
    title: s.title,
    level: s.level,
    builtIn: true,
    sentences: s.lines.map(([text, en, zh]): Sentence => ({ start: null, end: null, text, translations: { en, zh } })),
  }))
