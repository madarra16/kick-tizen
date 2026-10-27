"""Build app/js/i18n-data.js: the app's texts in the 9 languages besides English.

Texts that the official Kick TV app also has use Kick's own translations (read from the
decompiled APK's res/values-<lang>/strings.xml, see OFFICIAL). The rest are our own (OWN).
English is the source: the app calls K.t('<English text>', {vars}).

Usage: python3 build_i18n.py <res dir of the decompiled official Kick APK>
"""

import json
import pathlib
import re
import sys
import xml.etree.ElementTree as ET

HERE = pathlib.Path(__file__).resolve().parent
if len(sys.argv) != 2:
    sys.exit(__doc__)
RES = pathlib.Path(sys.argv[1])
OUT = HERE.parent / "app" / "js" / "i18n-data.js"
LANGS = ["es", "de", "pt", "fr", "zh", "ja", "ko", "hi", "ar"]

# English text -> (official string name, {official placeholder: ours}, suffix added to the translation)
OFFICIAL = {
    "Home": ("generic_home",),
    "Categories": ("generic_categories",),
    "Live": ("generic_live",),
    "Following": ("generic_following",),
    "Search": ("generic_search",),
    "*Categories* For You": ("home_categories_for_you",),
    "*Streams* For You": ("home_streams_for_you",),
    "{n} viewers": ("browse_viewers", {"count": "n"}),
    "You haven't signed into your account yet": ("tv_you_haven_t_signed_yet",),
    "Please sign in to see your following content.": ("tv_please_sign_in_to_see_following_content",),
    "Sign in": ("tv_login_title",),
    "Loading…": ("generic_loading", {}, "…"),
    "Try again": ("tv_login_unsuccessful_retry",),
    "You haven't followed any channels": ("following_no_channels_title",),
    "Discover new streamers.": ("tv_discover_new_streamers",),
    "Live channels": ("live_channels",),
    "At the moment, no one is streaming": ("following_livestreams_placeholder_title",),
    "Offline channels": ("offline_channels",),
    "Recent Search": ("search_recent_search",),
    "We couldn't find any matches for '{q}'": ("search_no_matches_title", {"query": "q"}),
    "Try searching for a different term.": ("search_no_matches_copy",),
    "Channels": ("search_tab_channels",),
    "{n} followers": ("channel_followers", {"count": "n"}),
    "Livestreams": ("browse_livestreams",),
    "Clips": ("generic_clips",),
    "Recent broadcasts": ("channel_recent_broadcasts",),
    "No clips available": ("channel_clips_not_found",),
    "No videos available": ("channel_videos_not_found",),
    "Offline": ("channel_offline",),
    "LIVE": ("live_uppercase",),
    "Watch Live": ("tv_watch_live",),
    "Follow": ("generic_follow",),
    "Unfollow": ("generic_button_label_unfollow",),
    "Follow {name}": ("tv_channel_follow", {"username": "name"}),
    "Unfollow {name}": ("tv_channel_unfollow", {"username": "name"}),
    "Done": ("generic_button_label_done",),
    "Preferences": ("tv_settings_preferences",),
    "Language": ("tv_settings_language",),
    "Auto": ("livestream_quality_auto",),
    "Resolution": ("generic_resolution",),
    "On": ("state_on",),
    "Off": ("state_off",),
    "Chat": ("chat_title",),
    "Content Preferences": ("tv_settings_content_preferences_title",),
    "Customize your experience by selecting the types of content you'd like to hide": ("tv_settings_content_preferences_subtitle",),
    "Find Help online": ("tv_settings_find_help_online",),
    "Help": ("settings_help",),
    "Privacy Policy": ("privacy_policy",),
    "Terms of Service": ("terms_of_service",),
    "Open Source Licences": ("tv_settings_open_source_licenses",),
    "Licensing information": ("tv_settings_licensing_information",),
    "App information": ("tv_settings_app_information",),
    "Visit {url}": ("settings_visit",),
    "Version {v}": ("device_information_app_version", {}, " {v}"),
    "Log out": ("generic_log_out",),
    "Cancel": ("generic_button_label_cancel",),
    "Make sure you have the Kick mobile app and are signed in": ("tv_login_step_1_instructions",),
    "Scan the QR code with your smartphone camera": ("tv_login_step_2_instructions",),
    "Confirm the code below matches with the one on your KICK mobile app": ("tv_login_step_3_instructions",),
    "Step {n}": ("tv_login_step", {"step": "n"}),
    "Back": ("generic_button_label_back",),
    "Close": ("generic_close",),
    "{name} is offline": ("channel_channel_is_offline", {"channel": "name"}),
    "This channel is not live right now.": ("chatroom_commands_host_error_channel_not_live",),
    "Channel": ("generic_channel",),
    "Are you still watching?": ("tv_user_inactivity_modal_text",),
    "Yes": ("tv_user_inactivity_modal_confirm",),
    "No": ("tv_user_inactivity_modal_cancel",),
    "Stream ended.": ("tv_stream_ended",),
    "Pinned from {name}": ("tv_chat_pinned_from", {}, " {name}"),
    "{name} has subscribed": ("chatroom_banner_subs", {"username": "name"}),
    "{name} gifted {n} subs": ("chatroom_banner_gift", {"username": "name", "count": "n"}),
    "{name} hosted with {n} viewers": ("tv_chat_host_event_banner", {"username": "name", "viewers_count": "n"}),
    "Welcome to the chat room!": ("tv_chat_welcome",),
    "a minute ago": ("channel_recent_broadcasts_a_minute_ago",),
    "{n} minutes ago": ("channel_recent_broadcasts_minutes_ago", {"minutes": "n"}),
    "an hour ago": ("channel_recent_broadcasts_an_hour_ago",),
    "{n} hours ago": ("channel_recent_broadcasts_hours_ago", {"hours": "n"}),
    "a day ago": ("channel_recent_broadcasts_a_day_ago",),
    "{n} days ago": ("channel_recent_broadcasts_days_ago", {"days": "n"}),
    "a month ago": ("channel_recent_broadcasts_a_month_ago",),
    "{n} months ago": ("channel_recent_broadcasts_months_ago", {"months": "n"}),
}

# English text -> translations in LANGS order (es, de, pt, fr, zh, ja, ko, hi, ar).
# Also the fallback where an official translation is missing for a language.
OWN = {
    "Connect": ["Conectar", "Verbinden", "Conectar", "Se connecter", "连接", "接続", "연결", "कनेक्ट करें", "اتصال"],
    "Live in *{name}*": ["En directo en *{name}*", "Live in *{name}*", "Ao vivo em *{name}*", "En direct dans *{name}*", "*{name}* 直播中", "*{name}* のライブ", "*{name}* 라이브", "*{name}* में लाइव", "بث مباشر في *{name}*"],
    "No featured streams right now": ["No hay transmisiones destacadas ahora", "Gerade keine empfohlenen Streams", "Nenhuma transmissão em destaque agora", "Aucun live mis en avant pour le moment", "当前没有精选直播", "現在おすすめの配信はありません", "지금은 추천 방송이 없습니다", "अभी कोई फ़ीचर्ड स्ट्रीम नहीं है", "لا توجد بثوث مميزة حاليًا"],
    "Kick did not answer. Open Home again in a moment.": ["Kick no respondió. Vuelve a abrir Inicio en un momento.", "Kick hat nicht geantwortet. Öffne die Startseite gleich noch einmal.", "O Kick não respondeu. Abra o Início novamente daqui a pouco.", "Kick n'a pas répondu. Rouvrez l'accueil dans un instant.", "Kick 没有响应。请稍后重新打开首页。", "Kick から応答がありません。しばらくしてからホームを開き直してください。", "Kick이 응답하지 않습니다. 잠시 후 홈을 다시 열어 주세요.", "Kick ने जवाब नहीं दिया। थोड़ी देर में होम फिर से खोलें।", "لم يستجب Kick. افتح الصفحة الرئيسية مرة أخرى بعد قليل."],
    "Nothing live here right now.": ["No hay nada en directo aquí ahora.", "Hier ist gerade nichts live.", "Nada ao vivo aqui agora.", "Rien en direct ici pour l'instant.", "这里暂时没有直播。", "現在ここにライブ配信はありません。", "지금은 이곳에 라이브 방송이 없습니다.", "अभी यहाँ कुछ भी लाइव नहीं है।", "لا يوجد بث مباشر هنا حاليًا."],
    "Could not load": ["No se pudo cargar", "Laden fehlgeschlagen", "Não foi possível carregar", "Chargement impossible", "无法加载", "読み込めませんでした", "불러올 수 없습니다", "लोड नहीं हो सका", "تعذّر التحميل"],
    "Kick did not answer.": ["Kick no respondió.", "Kick hat nicht geantwortet.", "O Kick não respondeu.", "Kick n'a pas répondu.", "Kick 没有响应。", "Kick から応答がありません。", "Kick이 응답하지 않습니다.", "Kick ने जवाब नहीं दिया।", "لم يستجب Kick."],
    "Kick did not answer ({n}).": ["Kick no respondió ({n}).", "Kick hat nicht geantwortet ({n}).", "O Kick não respondeu ({n}).", "Kick n'a pas répondu ({n}).", "Kick 没有响应（{n}）。", "Kick から応答がありません（{n}）。", "Kick이 응답하지 않습니다({n}).", "Kick ने जवाब नहीं दिया ({n})।", "لم يستجب Kick ({n})."],
    "Kick did not accept the sign-in (HTTP {n}). Log out and sign in again in Account.": ["Kick no aceptó el inicio de sesión (HTTP {n}). Cierra sesión y vuelve a iniciarla en Cuenta.", "Kick hat die Anmeldung nicht akzeptiert (HTTP {n}). Melde dich unter Konto ab und wieder an.", "O Kick não aceitou o login (HTTP {n}). Saia e entre novamente em Conta.", "Kick n'a pas accepté la connexion (HTTP {n}). Déconnectez-vous puis reconnectez-vous dans Compte.", "Kick 未接受登录（HTTP {n}）。请在“账户”中退出后重新登录。", "Kick がログインを受け付けませんでした（HTTP {n}）。アカウントでログアウトしてから再度ログインしてください。", "Kick이 로그인을 받아들이지 않았습니다(HTTP {n}). 계정에서 로그아웃한 후 다시 로그인하세요.", "Kick ने साइन-इन स्वीकार नहीं किया (HTTP {n})। अकाउंट में लॉग आउट करके फिर से साइन इन करें।", "لم يقبل Kick تسجيل الدخول (HTTP {n}). سجّل الخروج ثم سجّل الدخول مجددًا من الحساب."],
    "Could not load your follows": ["No se pudieron cargar tus canales seguidos", "Deine gefolgten Kanäle konnten nicht geladen werden", "Não foi possível carregar os canais que você segue", "Impossible de charger vos abonnements", "无法加载你的关注", "フォロー中のチャンネルを読み込めませんでした", "팔로우 목록을 불러올 수 없습니다", "आपके फ़ॉलो किए गए चैनल लोड नहीं हो सके", "تعذّر تحميل القنوات التي تتابعها"],
    "network error": ["error de red", "Netzwerkfehler", "erro de rede", "erreur réseau", "网络错误", "ネットワークエラー", "네트워크 오류", "नेटवर्क त्रुटि", "خطأ في الشبكة"],
    "Go to Live": ["Ir a En directo", "Zu Live", "Ir para Ao vivo", "Aller au direct", "前往直播", "ライブへ", "라이브로 이동", "लाइव पर जाएँ", "الانتقال إلى البث المباشر"],
    "Type at least 2 characters to search channels, categories and livestreams.": ["Escribe al menos 2 caracteres para buscar canales, categorías y transmisiones.", "Gib mindestens 2 Zeichen ein, um Kanäle, Kategorien und Livestreams zu suchen.", "Digite pelo menos 2 caracteres para buscar canais, categorias e transmissões.", "Saisissez au moins 2 caractères pour rechercher des chaînes, des catégories et des lives.", "输入至少 2 个字符以搜索频道、分类和直播。", "チャンネル、カテゴリー、ライブ配信を検索するには2文字以上入力してください。", "채널, 카테고리, 라이브 방송을 검색하려면 2자 이상 입력하세요.", "चैनल, कैटेगरी और लाइवस्ट्रीम खोजने के लिए कम से कम 2 अक्षर टाइप करें।", "اكتب حرفين على الأقل للبحث عن القنوات والفئات والبثوث المباشرة."],
    "Searching…": ["Buscando…", "Suche läuft…", "Buscando…", "Recherche…", "正在搜索…", "検索中…", "검색 중…", "खोज रहे हैं…", "جارٍ البحث…"],
    "Search failed": ["La búsqueda falló", "Suche fehlgeschlagen", "A busca falhou", "La recherche a échoué", "搜索失败", "検索に失敗しました", "검색에 실패했습니다", "खोज विफल रही", "فشل البحث"],
    "Past broadcast": ["Emisión anterior", "Vergangene Übertragung", "Transmissão anterior", "Diffusion passée", "往期直播", "過去の配信", "지난 방송", "पिछला प्रसारण", "بث سابق"],
    "Clip": ["Clip", "Clip", "Clipe", "Clip", "剪辑", "クリップ", "클립", "क्लिप", "مقطع"],
    "LIVE": ["EN DIRECTO", "LIVE", "AO VIVO", "EN DIRECT", "直播", "ライブ", "라이브", "लाइव", "مباشر"],
    "Scan the QR code with your phone to follow {name} in the Kick app.": ["Escanea el código QR con tu teléfono para seguir a {name} en la app de Kick.", "Scanne den QR-Code mit deinem Handy, um {name} in der Kick-App zu folgen.", "Escaneie o código QR com o celular para seguir {name} no app do Kick.", "Scannez le code QR avec votre téléphone pour suivre {name} dans l'app Kick.", "用手机扫描二维码，在 Kick 应用中关注 {name}。", "スマートフォンでQRコードをスキャンして、Kick アプリで {name} をフォローしてください。", "휴대폰으로 QR 코드를 스캔해 Kick 앱에서 {name}님을 팔로우하세요.", "Kick ऐप में {name} को फ़ॉलो करने के लिए अपने फ़ोन से QR कोड स्कैन करें।", "امسح رمز QR بهاتفك لمتابعة {name} في تطبيق Kick."],
    "Scan the QR code with your phone to unfollow {name} in the Kick app.": ["Escanea el código QR con tu teléfono para dejar de seguir a {name} en la app de Kick.", "Scanne den QR-Code mit deinem Handy, um {name} in der Kick-App nicht mehr zu folgen.", "Escaneie o código QR com o celular para deixar de seguir {name} no app do Kick.", "Scannez le code QR avec votre téléphone pour ne plus suivre {name} dans l'app Kick.", "用手机扫描二维码，在 Kick 应用中取消关注 {name}。", "スマートフォンでQRコードをスキャンして、Kick アプリで {name} のフォローを解除してください。", "휴대폰으로 QR 코드를 스캔해 Kick 앱에서 {name}님 팔로우를 취소하세요.", "Kick ऐप में {name} को अनफ़ॉलो करने के लिए अपने फ़ोन से QR कोड स्कैन करें।", "امسح رمز QR بهاتفك لإلغاء متابعة {name} في تطبيق Kick."],
    "Account": ["Cuenta", "Konto", "Conta", "Compte", "账户", "アカウント", "계정", "अकाउंट", "الحساب"],
    "Kick account": ["Cuenta de Kick", "Kick-Konto", "Conta do Kick", "Compte Kick", "Kick 账户", "Kick アカウント", "Kick 계정", "Kick अकाउंट", "حساب Kick"],
    "Profile not loaded · OK to retry": ["Perfil no cargado · OK para reintentar", "Profil nicht geladen · OK zum Wiederholen", "Perfil não carregado · OK para tentar de novo", "Profil non chargé · OK pour réessayer", "个人资料未加载 · 按 OK 重试", "プロフィールを読み込めません · OKで再試行", "프로필을 불러오지 못함 · OK로 다시 시도", "प्रोफ़ाइल लोड नहीं हुई · फिर से कोशिश के लिए OK", "لم يتم تحميل الملف الشخصي · اضغط OK لإعادة المحاولة"],
    "Your channel": ["Tu canal", "Dein Kanal", "Seu canal", "Votre chaîne", "你的频道", "あなたのチャンネル", "내 채널", "आपका चैनल", "قناتك"],
    "Use the Kick app on your phone": ["Usa la app de Kick en tu teléfono", "Mit der Kick-App auf deinem Handy", "Use o app do Kick no celular", "Avec l'app Kick sur votre téléphone", "使用手机上的 Kick 应用", "スマートフォンの Kick アプリを使用", "휴대폰의 Kick 앱 사용", "अपने फ़ोन पर Kick ऐप का उपयोग करें", "استخدم تطبيق Kick على هاتفك"],
    "Playback": ["Reproducción", "Wiedergabe", "Reprodução", "Lecture", "播放", "再生", "재생", "प्लेबैक", "التشغيل"],
    "Chat when a stream starts": ["Chat al iniciar una transmisión", "Chat beim Start eines Streams", "Chat ao iniciar uma transmissão", "Chat au lancement d'un live", "开始观看时显示聊天", "配信開始時にチャットを表示", "방송 시작 시 채팅 표시", "स्ट्रीम शुरू होने पर चैट", "الدردشة عند بدء البث"],
    "Hide gambling streams": ["Ocultar transmisiones de apuestas", "Glücksspiel-Streams ausblenden", "Ocultar transmissões de apostas", "Masquer les lives de jeux d'argent", "隐藏博彩直播", "ギャンブル配信を非表示", "도박 방송 숨기기", "जुआ स्ट्रीम छिपाएँ", "إخفاء بثوث المقامرة"],
    "Hide 18+ streams": ["Ocultar transmisiones +18", "18+-Streams ausblenden", "Ocultar transmissões 18+", "Masquer les lives 18+", "隐藏 18+ 直播", "18+ 配信を非表示", "18+ 방송 숨기기", "18+ स्ट्रीम छिपाएँ", "إخفاء بثوث +18"],
    "Help & Legal": ["Ayuda y aspectos legales", "Hilfe & Rechtliches", "Ajuda e informações legais", "Aide et mentions légales", "帮助与法律", "ヘルプと法的情報", "도움말 및 법적 고지", "सहायता और कानूनी", "المساعدة والشؤون القانونية"],
    "Kick for Samsung Smart TV": ["Kick para Samsung Smart TV", "Kick für Samsung Smart TV", "Kick para Samsung Smart TV", "Kick pour Samsung Smart TV", "适用于 Samsung Smart TV 的 Kick", "Samsung Smart TV 版 Kick", "Samsung Smart TV용 Kick", "Samsung Smart TV के लिए Kick", "Kick لأجهزة Samsung Smart TV"],
    "Log out?": ["¿Cerrar sesión?", "Abmelden?", "Sair?", "Se déconnecter ?", "要退出登录吗？", "ログアウトしますか？", "로그아웃할까요?", "लॉग आउट करें?", "تسجيل الخروج؟"],
    "Your Kick sign-in will be removed from this TV.": ["Tu sesión de Kick se eliminará de este televisor.", "Deine Kick-Anmeldung wird von diesem Fernseher entfernt.", "Seu login do Kick será removido desta TV.", "Votre connexion Kick sera supprimée de ce téléviseur.", "你的 Kick 登录信息将从这台电视中移除。", "このテレビから Kick のログイン情報が削除されます。", "이 TV에서 Kick 로그인 정보가 삭제됩니다.", "आपका Kick साइन-इन इस टीवी से हटा दिया जाएगा।", "ستتم إزالة تسجيل دخولك إلى Kick من هذا التلفزيون."],
    "New code": ["Nuevo código", "Neuer Code", "Novo código", "Nouveau code", "新代码", "新しいコード", "새 코드", "नया कोड", "رمز جديد"],
    "Signed in": ["Sesión iniciada", "Angemeldet", "Login feito", "Connecté", "已登录", "ログインしました", "로그인됨", "साइन इन हो गया", "تم تسجيل الدخول"],
    "Signed in as {name}": ["Sesión iniciada como {name}", "Angemeldet als {name}", "Conectado como {name}", "Connecté en tant que {name}", "已登录为 {name}", "{name} としてログインしました", "{name}(으)로 로그인됨", "{name} के रूप में साइन इन", "تم تسجيل الدخول باسم {name}"],
    "The code expired. Choose \"New code\".": ["El código caducó. Elige «Nuevo código».", "Der Code ist abgelaufen. Wähle „Neuer Code“.", "O código expirou. Escolha \"Novo código\".", "Le code a expiré. Choisissez « Nouveau code ».", "代码已过期。请选择“新代码”。", "コードの有効期限が切れました。「新しいコード」を選んでください。", "코드가 만료되었습니다. \"새 코드\"를 선택하세요.", "कोड की समय सीमा खत्म हो गई। \"नया कोड\" चुनें।", "انتهت صلاحية الرمز. اختر \"رمز جديد\"."],
    "Logging in… waiting for your phone": ["Iniciando sesión… esperando a tu teléfono", "Anmeldung… warte auf dein Handy", "Entrando… aguardando seu celular", "Connexion… en attente de votre téléphone", "正在登录…等待你的手机确认", "ログイン中… スマートフォンでの確認を待っています", "로그인 중… 휴대폰 확인을 기다리는 중", "लॉग इन हो रहा है… आपके फ़ोन का इंतज़ार", "جارٍ تسجيل الدخول… بانتظار هاتفك"],
    "Kick answered {n}. Still waiting…": ["Kick respondió {n}. Seguimos esperando…", "Kick antwortete {n}. Warte weiter…", "O Kick respondeu {n}. Ainda aguardando…", "Kick a répondu {n}. Toujours en attente…", "Kick 返回 {n}。仍在等待…", "Kick の応答: {n}。引き続き待機中…", "Kick 응답: {n}. 계속 기다리는 중…", "Kick ने {n} जवाब दिया। अभी भी इंतज़ार…", "ردّ Kick بـ {n}. ما زلنا ننتظر…"],
    "Exit Kick?": ["¿Salir de Kick?", "Kick beenden?", "Sair do Kick?", "Quitter Kick ?", "要退出 Kick 吗？", "Kick を終了しますか？", "Kick을 종료할까요?", "Kick से बाहर निकलें?", "الخروج من Kick؟"],
    "Exit": ["Salir", "Beenden", "Sair", "Quitter", "退出", "終了", "종료", "बाहर निकलें", "خروج"],
    "The video did not start": ["El video no se inició", "Das Video ist nicht gestartet", "O vídeo não começou", "La vidéo n'a pas démarré", "视频未能开始播放", "動画が開始されませんでした", "동영상이 시작되지 않았습니다", "वीडियो शुरू नहीं हुआ", "لم يبدأ الفيديو"],
    "Nothing arrived within {n} seconds.": ["No llegó nada en {n} segundos.", "Innerhalb von {n} Sekunden kam nichts an.", "Nada chegou em {n} segundos.", "Rien n'est arrivé en {n} secondes.", "{n} 秒内没有收到任何数据。", "{n} 秒以内にデータが届きませんでした。", "{n}초 안에 아무것도 수신되지 않았습니다.", "{n} सेकंड में कुछ नहीं आया।", "لم يصل أي شيء خلال {n} ثانية."],
    "Buffering {n} %": ["Cargando {n} %", "Puffern {n} %", "Carregando {n} %", "Mise en mémoire tampon {n} %", "缓冲中 {n}%", "バッファリング中 {n}%", "버퍼링 {n}%", "बफ़रिंग {n} %", "جارٍ التخزين المؤقت {n}٪"],
    "Playback error": ["Error de reproducción", "Wiedergabefehler", "Erro de reprodução", "Erreur de lecture", "播放错误", "再生エラー", "재생 오류", "प्लेबैक त्रुटि", "خطأ في التشغيل"],
    "Cannot play": ["No se puede reproducir", "Wiedergabe nicht möglich", "Não é possível reproduzir", "Lecture impossible", "无法播放", "再生できません", "재생할 수 없습니다", "चलाया नहीं जा सकता", "تعذّر التشغيل"],
    "Cannot start": ["No se puede iniciar", "Start nicht möglich", "Não é possível iniciar", "Démarrage impossible", "无法开始", "開始できません", "시작할 수 없습니다", "शुरू नहीं हो सका", "تعذّر البدء"],
    "Back to live": ["Volver al directo", "Zurück zu live", "Voltar ao vivo", "Retour au direct", "回到直播", "ライブに戻る", "라이브로 돌아가기", "लाइव पर वापस", "العودة إلى البث المباشر"],
    "Back to live…": ["Volviendo al directo…", "Zurück zu live…", "Voltando ao vivo…", "Retour au direct…", "正在回到直播…", "ライブに戻っています…", "라이브로 돌아가는 중…", "लाइव पर लौट रहे हैं…", "جارٍ العودة إلى البث المباشر…"],
    "Video ended": ["El video terminó", "Video beendet", "O vídeo terminou", "Vidéo terminée", "视频已结束", "動画が終了しました", "동영상이 끝났습니다", "वीडियो समाप्त", "انتهى الفيديو"],
    "Replay": ["Volver a ver", "Erneut abspielen", "Assistir de novo", "Revoir", "重播", "もう一度再生", "다시 보기", "फिर से चलाएँ", "إعادة التشغيل"],
    "Loading stream…": ["Cargando transmisión…", "Stream wird geladen…", "Carregando transmissão…", "Chargement du live…", "正在加载直播…", "配信を読み込み中…", "방송 불러오는 중…", "स्ट्रीम लोड हो रही है…", "جارٍ تحميل البث…"],
    "Loading clip…": ["Cargando clip…", "Clip wird geladen…", "Carregando clipe…", "Chargement du clip…", "正在加载剪辑…", "クリップを読み込み中…", "클립 불러오는 중…", "क्लिप लोड हो रही है…", "جارٍ تحميل المقطع…"],
    "Loading video…": ["Cargando video…", "Video wird geladen…", "Carregando vídeo…", "Chargement de la vidéo…", "正在加载视频…", "動画を読み込み中…", "동영상 불러오는 중…", "वीडियो लोड हो रहा है…", "جارٍ تحميل الفيديو…"],
    "Check the network connection.": ["Comprueba la conexión de red.", "Prüfe die Netzwerkverbindung.", "Verifique a conexão de rede.", "Vérifiez la connexion réseau.", "请检查网络连接。", "ネットワーク接続を確認してください。", "네트워크 연결을 확인하세요.", "नेटवर्क कनेक्शन जाँचें।", "تحقق من اتصال الشبكة."],
    "Rewinding…": ["Retrocediendo…", "Zurückspulen…", "Voltando…", "Retour en arrière…", "正在回退…", "巻き戻し中…", "되감는 중…", "पीछे ले जा रहे हैं…", "جارٍ الترجيع…"],
    "Can't rewind": ["No se puede retroceder", "Zurückspulen nicht möglich", "Não é possível voltar", "Retour en arrière impossible", "无法回退", "巻き戻しできません", "되감을 수 없습니다", "पीछे नहीं जा सकते", "تعذّر الترجيع"],
    "Kick's recording of this stream did not load.": ["No se cargó la grabación de Kick de esta transmisión.", "Kicks Aufzeichnung dieses Streams wurde nicht geladen.", "A gravação do Kick desta transmissão não carregou.", "L'enregistrement Kick de ce live n'a pas pu être chargé.", "未能加载 Kick 对此直播的录像。", "この配信の Kick の録画を読み込めませんでした。", "이 방송의 Kick 녹화본을 불러오지 못했습니다.", "इस स्ट्रीम की Kick रिकॉर्डिंग लोड नहीं हुई।", "تعذّر تحميل تسجيل Kick لهذا البث."],
    "You're watching live": ["Estás viendo en directo", "Du siehst live", "Você está assistindo ao vivo", "Vous regardez en direct", "你正在观看直播", "ライブで視聴中です", "라이브로 시청 중입니다", "आप लाइव देख रहे हैं", "أنت تشاهد البث المباشر"],
    "Rewinding isn't available for this stream": ["No se puede retroceder en esta transmisión", "Zurückspulen ist bei diesem Stream nicht möglich", "Não é possível voltar nesta transmissão", "Le retour en arrière n'est pas disponible pour ce live", "此直播不支持回退", "この配信は巻き戻しできません", "이 방송은 되감기를 지원하지 않습니다", "इस स्ट्रीम में पीछे जाना उपलब्ध नहीं है", "الترجيع غير متاح لهذا البث"],
    "Can't jump there": ["No se puede saltar ahí", "Dorthin springen nicht möglich", "Não é possível pular para lá", "Impossible d'aller à cet endroit", "无法跳转到该位置", "その位置に移動できません", "해당 위치로 이동할 수 없습니다", "वहाँ नहीं जा सकते", "تعذّر الانتقال إلى هناك"],
    "{name} is no longer live.": ["{name} ya no está en directo.", "{name} ist nicht mehr live.", "{name} não está mais ao vivo.", "{name} n'est plus en direct.", "{name} 的直播已结束。", "{name} の配信は終了しました。", "{name}님의 방송이 종료되었습니다.", "{name} अब लाइव नहीं है।", "لم يعد {name} في بث مباشر."],
    "Reconnecting…": ["Reconectando…", "Verbindung wird wiederhergestellt…", "Reconectando…", "Reconnexion…", "正在重新连接…", "再接続中…", "다시 연결하는 중…", "फिर से कनेक्ट हो रहा है…", "جارٍ إعادة الاتصال…"],
    "Go live": ["Ir al directo", "Zu live", "Ir ao vivo", "Aller au direct", "回到直播", "ライブへ", "라이브로", "लाइव पर जाएँ", "انتقل إلى المباشر"],
    "Hide chat": ["Ocultar chat", "Chat ausblenden", "Ocultar chat", "Masquer le chat", "隐藏聊天", "チャットを非表示", "채팅 숨기기", "चैट छिपाएँ", "إخفاء الدردشة"],
    "Switching to {q}…": ["Cambiando a {q}…", "Wechsle zu {q}…", "Mudando para {q}…", "Passage à {q}…", "正在切换到 {q}…", "{q} に切り替え中…", "{q}(으)로 전환 중…", "{q} पर बदल रहे हैं…", "جارٍ التبديل إلى {q}…"],
    "{t} behind live": ["{t} por detrás del directo", "{t} hinter live", "{t} atrás do ao vivo", "{t} de retard sur le direct", "落后直播 {t}", "ライブから {t} 遅れ", "라이브보다 {t} 늦음", "लाइव से {t} पीछे", "متأخر {t} عن المباشر"],
    "Original": ["Original", "Original", "Original", "Original", "原画", "オリジナル", "원본", "मूल", "الأصلية"],
    "Someone": ["Alguien", "Jemand", "Alguém", "Quelqu'un", "有人", "誰か", "누군가", "कोई", "شخص ما"],
    "Helper did not start": ["El asistente no se inició", "Der Helfer ist nicht gestartet", "O assistente não iniciou", "Le service d'aide n'a pas démarré", "辅助服务未启动", "ヘルパーが起動しませんでした", "도우미 서비스가 시작되지 않았습니다", "हेल्पर शुरू नहीं हुआ", "لم تبدأ الخدمة المساعدة"],
    "The stream helper service is not running. Try again.": ["El servicio de ayuda para transmisiones no está en ejecución. Inténtalo de nuevo.", "Der Stream-Helferdienst läuft nicht. Versuche es noch einmal.", "O serviço auxiliar de transmissão não está em execução. Tente novamente.", "Le service d'aide aux lives ne fonctionne pas. Réessayez.", "直播辅助服务未运行。请重试。", "配信ヘルパーサービスが動作していません。もう一度お試しください。", "방송 도우미 서비스가 실행되지 않고 있습니다. 다시 시도하세요.", "स्ट्रीम हेल्पर सेवा नहीं चल रही है। फिर से कोशिश करें।", "خدمة مساعد البث لا تعمل. حاول مرة أخرى."],
    "Content language": ["Idioma del contenido", "Inhaltssprache", "Idioma do conteúdo", "Langue du contenu", "内容语言", "コンテンツの言語", "콘텐츠 언어", "कंटेंट की भाषा", "لغة المحتوى"],
    "All languages": ["Todos los idiomas", "Alle Sprachen", "Todos os idiomas", "Toutes les langues", "所有语言", "すべての言語", "모든 언어", "सभी भाषाएँ", "جميع اللغات"],
    "On": ["Activado", "Ein", "Ativado", "Activé", "开", "オン", "켜짐", "चालू", "تشغيل"],
    "Off": ["Desactivado", "Aus", "Desativado", "Désactivé", "关", "オフ", "꺼짐", "बंद", "إيقاف"],
    "just now": ["justo ahora", "gerade eben", "agora mesmo", "à l'instant", "刚刚", "たった今", "방금", "अभी-अभी", "الآن"],
    "a year ago": ["hace un año", "vor einem Jahr", "há um ano", "il y a un an", "1 年前", "1 年前", "1년 전", "एक साल पहले", "منذ سنة"],
    "{n} years ago": ["hace {n} años", "vor {n} Jahren", "há {n} anos", "il y a {n} ans", "{n} 年前", "{n} 年前", "{n}년 전", "{n} साल पहले", "منذ {n} سنوات"],
}


def load(lang):
    path = RES / ("values-%s" % lang) / "strings.xml"
    out = {}
    for s in ET.parse(path).getroot().iter("string"):
        text = "".join(s.itertext()).strip()
        if len(text) >= 2 and text[0] == '"' and text[-1] == '"':
            text = text[1:-1]
        out[s.get("name")] = text.replace("\\'", "'").replace('\\"', '"').replace("\\n", "\n")
    return out


def main():
    data, report = {}, []
    for i, lang in enumerate(LANGS):
        strings, d = load(lang), {}
        for en, spec in OFFICIAL.items():
            name, renames, suffix = (list(spec) + [{}, ""])[:3]
            text = strings.get(name)
            if not text or not text.strip():
                if en in OWN:
                    d[en] = OWN[en][i]
                else:
                    report.append("%s: no official %s, stays English" % (lang, name))
                continue
            for theirs, ours in (renames or {}).items():
                text = text.replace("{%s}" % theirs, "{%s}" % ours)
            leftover = set(re.findall(r"\{(\w+)\}", text)) - set(re.findall(r"\{(\w+)\}", en))
            if leftover:
                report.append("%s: %s has unknown placeholders %s, using ours" % (lang, name, leftover))
                if en in OWN:
                    d[en] = OWN[en][i]
                continue
            d[en] = text + (suffix or "")
        for en, texts in OWN.items():
            assert len(texts) == len(LANGS), en
            d.setdefault(en, texts[i])
            assert set(re.findall(r"\{(\w+)\}", d[en])) == set(re.findall(r"\{(\w+)\}", en)), (lang, en, d[en])
        data[lang] = d
    js = ("/* Generated by kick-app/i18n/build_i18n.py: do not edit. Texts the official Kick TV app also\n"
          "   has use Kick's translations from its APK; the others are ours. */\n"
          "window.K_I18N = " + json.dumps(data, ensure_ascii=False, indent=0, sort_keys=True) + ";\n")
    OUT.write_text(js, encoding="utf-8")
    print("wrote %s: %d languages x %d texts (%d official)" % (OUT, len(data), len(data["de"]), len(OFFICIAL)))
    for line in report:
        print("  note:", line)


main()
