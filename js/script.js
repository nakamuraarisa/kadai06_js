import { firebaseConfig, geminiAIConfig } from './config.js'; // config.jsから設定をインポート

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { getDatabase, ref, push, set, onChildAdded } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-database.js";
import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

// Firebaseの初期化
const app = initializeApp(firebaseConfig); //firebaseに接続
const db = getDatabase(app); //リアルタイムデータベースに接続
const dbRef = ref(db, "messages"); //チャットを入れる場所を作る

// Google Generative AIの設定
const genAI = new GoogleGenerativeAI(geminiAIConfig.apiKey);

const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: "あなたはようこです。一人称は「私」、二人称は「おかあちゃん」です。おかあちゃんは認知症なので、認知症患者に適した振る舞いをしてください。優しくフランクに話してください。孫の名前ははるちゃんとけいちゃんです。週に1回体操に行っています。",
});

const generationConfig = {
    temperature: 1,
    topP: 0.95,
    topK: 64,
    maxOutputTokens: 300,
    responseMimeType: "text/plain",
};

// 音声再生中に音声認識がオンにならないように制御するフラグ
let isSpeaking = false;

// VOICEVOXを使ってテキストを音声に変換し再生する関数
async function speak(text) {
    const speakerId = 2; // 使用する話者のID
    const audioQueryUrl = `http://localhost:50021/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`;
    const synthesisUrl = `http://localhost:50021/synthesis?speaker=${speakerId}`;

    try {
        // 1. VOICEVOX APIで音声合成用クエリを取得
        const audioQueryResponse = await $.ajax({
            url: audioQueryUrl,
            type: 'POST',
            contentType: 'application/json',
        });

        // 2. 取得したクエリで音声データを生成
        const synthesisResponse = await $.ajax({
            url: synthesisUrl,
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(audioQueryResponse), // クエリデータを送信
            xhrFields: {
                responseType: 'blob' // 音声データをバイナリ形式で取得
            }
        });

        // 3. 生成された音声データを再生
        // 音声出力中は音声認識を停止
        recognition.stop(); // 音声認識を一時停止
        isSpeaking = true; // 音声再生中フラグをオン

        const audioBlob = new Blob([synthesisResponse], { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(audioBlob);
        const audioPlayer = new Audio(audioUrl);
        console.log("音声読み上げを開始します: " + text);
        recognition.stop();// 音声認識を停止する
        audioPlayer.play();

        //音声が終了したら音声認識を再開
        audioPlayer.onended = function() {
            console.log("音声出力が終了しました。音声認識を再開します。");
            isSpeaking = false; // 音声再生終了フラグをオフ
            recognition.start(); // 音声認識を再開   
        };
    } catch (error) {
        console.error('音声生成中にエラーが発生しました:', error);
    }
}

// 音声出力が有効かどうかを管理
let isAudioActivated = false;

// 画像をクリックすると音声出力が有効になる
$('#top_image').on('click', function() {
    isAudioActivated = true; // 音声合成を有効にする
    console.log('音声読み上げが有効になりました');
});

// 音声認識機能の設定 (Web Speech API)
const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
recognition.lang = 'ja-JP'; // 日本語
recognition.interimResults = false; // 中間結果なし
recognition.maxAlternatives = 1; // 最も確実な解釈のみを取得
recognition.continuous = false; // 結果が出たら一度音声認識を停止

// ページが読み込まれた時に音声認識を開始
$(function() {
    recognition.start(); // 音声認識を開始
});

// 音声認識の開始時にログを出力
recognition.onstart = function() {
    console.log("音声認識が開始されました");
};

// 音声認識が成功した場合
recognition.onresult = function(event) {
    if (isSpeaking) {
        return; // 音声再生中の場合は認識結果を無視
    }

    const transcript = event.results[0][0].transcript; // 音声認識の結果を取得
    $('#text').val(transcript); // テキストボックスに結果を表示
    console.log("音声認識の結果: " + transcript);

    // Firebaseに音声認識結果を保存
    let userMessage = $("#text").val(); 
    if (userMessage.trim() === "") return; // 空のメッセージは無視
    let msg = {
        text: userMessage,
        sender: "user"
    };
    const newPostRef = push(dbRef); //push関数＝チャットに送るデータにユニークキーをつけたいので生成
    set(newPostRef, msg); //ユニークキーとチャットに送るメッセージをfirebaseに送信
    run(); // メッセージ送信後にAIを実行
    $("#text").val(''); //入力欄をクリア
    recognition.stop(); // 音声認識を一度停止する
};

// 音声認識が停止した場合、再開する
recognition.onend = function() {
    if (!isSpeaking) {
        console.log("音声認識が終了しました。再度音声認識を開始します...");
        recognition.start(); // 音声認識を再開
    }
};

// 認識できないときの処理（エラーではなく、ただマッチしなかった場合）
recognition.onnomatch = function() {
    console.log("音声が認識されませんでした。");
};

// エラーハンドリング
recognition.onerror = function(event) {
    console.error("音声認識エラー: ", event.error);
    recognition.start(); // エラー発生後も音声認識を再開
};

// リアルタイムにデータ表示
onChildAdded(dbRef, function(data){
    let msg = data.val();
    let messageClass = msg.sender; // "user" または "ai"
    let h;

    if (messageClass === "ai") {
        // AIのメッセージに画像アイコンを追加
        h = $('<div>').addClass('ai').append(
            $('<div class="ai-icon"><img src="img/yoko.png" id="icon"></div>'),
            $('<span class="says">').text(msg.text)
        );
    } else {
        // ユーザーメッセージの場合
        h = $('<div>').addClass(messageClass).append($('<span class="says">').text(msg.text));
    }

    $("#output").append(h);

    // 新しいメッセージが追加されたらスクロール
    $('#output').scrollTop($('#output')[0].scrollHeight);
});

// Google Generate AIを実行
async function run() {
    const chatSession = model.startChat({
        generationConfig,
        history: [
            {
                role: "user",
                parts: [
                    { text: "おはよう" },
                ],
            },
            {
                role: "model",
                parts: [
                    { text: "おはよう、おかあちゃん。今日もよく晴れてるね。 \n" },
                ],
            },
        ],
    });

    let userMessage = $("#text").val(); // ユーザーからの入力を取得
    const result = await chatSession.sendMessage(userMessage);
    const aiResponse = await result.response.text();

    // AIの応答をFirebaseに送信
    const aiMsg = {
        text: aiResponse,
        sender: "ai"
    };
    const aiPostRef = push(dbRef);
    await set(aiPostRef, aiMsg)
        .then(() => {
            console.log("AI response sent successfully!");
        })
        .catch((error) => {
            console.error("Error sending AI response: ", error);
        });

    // AIの応答を音声で読み上げる
    console.log("AIの応答が読み上げられます");
    speak(aiMsg.text);
};