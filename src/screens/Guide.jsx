import { useRef } from 'react';
import Icon from '../components/Icon.jsx';
import { senses } from '../lib/dict.js';
import { queueImport } from '../lib/imports.js';
import { filesFromInput } from '../lib/files.js';
import { warmUpTranslator } from '../lib/translate.js';
import { go } from '../App.jsx';

// Shown to new users in place of the empty library, and later from 使い方.
// The copy was written with yomiyasu (github.com/nanaism/yomiyasu) and checked with its linter.

// From EJDict-hand, as the dictionary popover shows it.
const MANAGE = '《しばしばcan, be able toと共に》…を『管理する』,運営する;…を処理する / 〈道具・機械など〉を『じょうずに扱う』,操る;〈人・動物〉をうまく使う / 《『manage to』do》『なんとか』(…)『する』,うまく(…)する;《時に皮肉に》愚かにも(…)する';

const SAMPLE = [
  { n: '01', en: 'I started running every morning last spring.', ja: '去年の春から、毎朝走っています。' },
  { n: '02', en: ['At first, I could only ', 'manage', ' ten minutes.'], ja: '最初は10分走るのがやっとでした。', current: true },
  { n: '03', en: 'Now it’s the part of the day I look forward to most.', ja: '今では、1日でいちばん楽しみな時間です。' },
];

export default function Guide({ onPickFiles, dropProps, standalone }) {
  // Opened on its own (from 使い方), the guide reads files in itself and then shows the library.
  const input = useRef(null);
  const pick = onPickFiles ?? (() => { warmUpTranslator(); input.current?.click(); });
  return (
    <main className="page guide" {...(dropProps ?? {})}>
      {!onPickFiles && (
        <input ref={input} type="file" multiple accept="audio/*,video/*" hidden
          onChange={async e => {
            const found = filesFromInput(e.target.files);
            e.target.value = '';
            if ((await queueImport(found, null)).queued) go('');
          }} />
      )}
      {standalone && (
        <header className="masthead">
          <a className="back" href="#/"><Icon name="back" size={14} />教材</a>
        </header>
      )}

      <section className="guide-hero">
        <h1>Kodama</h1>
        <p>英語のシャドーイングを練習するアプリです。TEDのトークや手持ちの音声を、1文ずつに区切って再生します。</p>
        <div className="intro-actions">
          <a className="button primary" href="#/add/ted">TEDから選ぶ</a>
          <button className="button" onClick={e => { e.stopPropagation(); pick(); }}>音声ファイルを読み込む</button>
        </div>
        <p className="field-note drop-hint">音声・動画のファイルやフォルダは、この画面にドロップしても読み込めます。</p>
      </section>

      <figure className="sample" aria-label="練習画面の見本">
        <figcaption>練習画面の見本</figcaption>
        <ol className="script-list" aria-hidden="true">
          {SAMPLE.map(s => (
            <li key={s.n} className={`row ${s.current ? 'current' : ''}`}>
              <span className="row-num">{s.n}</span>
              <div className="row-body">
                <p className="script">
                  {Array.isArray(s.en)
                    ? <>{s.en[0]}<span className="w sample-word">{s.en[1]}</span>{s.en[2]}</>
                    : s.en}
                </p>
                <p className="ja">{s.ja}</p>
                {s.current && (
                  <div className="popover sample-popover">
                    <p className="pop-head">manage</p>
                    <ol className="pop-senses">
                      {senses(MANAGE, 3).map((x, i) => <li key={i}>{x}</li>)}
                    </ol>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </figure>

      <section className="guide-section">
        <h2>使い方</h2>
        <ol className="steps">
          <li>
            <span className="step-num">1</span>
            <div>
              <h3>教材を入れる</h3>
              <p>「TEDから選ぶ」では、約5,000本のトークから探して追加します。手持ちの音声や動画は「音声ファイルを読み込む」から入れます。文字起こしと文の区切りは、この端末の中で行う仕組みです。</p>
            </div>
          </li>
          <li>
            <span className="step-num">2</span>
            <div>
              <h3>1文ずつ聞いて、声に出す</h3>
              <p>文をクリックすると、その文だけが流れます。聞こえたとおりに少し遅れて声に出すのが、シャドーイングです。慣れてきたら英文を隠し、耳だけで追いかけます。速さは0.75倍、1.0倍、1.25倍の3段階です。</p>
            </div>
          </li>
          <li>
            <span className="step-num">3</span>
            <div>
              <h3>録音して聞き比べる</h3>
              <p>録音は、設定で「する」を選んだときだけ使う機能です。お手本の再生と同時に自分の声を録り、あとから聞き比べます。お手本と自分の声を続けて聞くことも、左右の耳に分けて重ねて聞くこともできます。</p>
            </div>
          </li>
        </ol>
      </section>

      <section className="guide-section">
        <h2>できること</h2>
        <dl className="features">
          <dt>単語の意味</dt>
          <dd>練習中の文の単語をクリックすると、英和辞書の意味が出ます。plannedのような形を選んだときも、引くのはもとのplanです。</dd>
          <dt>和訳</dt>
          <dd>TEDの日本語訳がある文は、その訳を表示します。訳がない文の和訳は、教材を入れた時点でChromeの翻訳機能が作ります。Chrome以外のブラウザでは、文ごとにGoogle翻訳を開く方式です。</dd>
          <dt>通し再生とくり返し</dt>
          <dd>通し再生は、今の文を追いながら最後まで流す再生方法です。1文ずつ練習するときは、同じ文を3回、または止めるまでくり返せます。</dd>
          <dt>教材の整理</dt>
          <dd>フォルダを作って、教材を分けられます。ドラッグでの移動や名前順の並べ替えなど、操作はファイル管理アプリと同じです。</dd>
          <dt>続けた記録</dt>
          <dd>練習した日が続くと、連続日数と2週間分の記録が教材一覧に出ます。</dd>
        </dl>
      </section>

      <section className="guide-section">
        <h2>データの保存</h2>
        <p>教材・録音・和訳・練習の記録は、このブラウザの中にだけ保存します。サーバーには送りません。ブラウザのデータを消すと教材も一緒に消えるので、注意が必要です。</p>
      </section>

      <section className="guide-section">
        <h2>おすすめの環境</h2>
        <p>PCのChromeがおすすめです。機械翻訳はChromeでしか使えず、音声ファイルの文字起こしもPCのほうが速く進みます。スマホでも、TEDのトークで練習できます。</p>
        <p>録音するときは、ヘッドホンが必要です。スピーカーで流すと、お手本の音もマイクに入るためです。</p>
        <p>音声ファイルを初めて読み込むときは、文字起こし用のデータを約210MB読み込みます。</p>
      </section>

      <footer className="credits">
        <p>Kodamaという名前は、山で声を返す「こだま」から取りました。</p>
        <p>
          TEDのトークは、TEDがCC BY-NC-ND 4.0で公開している動画と字幕を、TEDの配信からそのまま再生しています。このアプリはTEDとは関係ありません。
          英和辞書はEJDict-hand（パブリックドメイン）を使っています。
        </p>
      </footer>
    </main>
  );
}
