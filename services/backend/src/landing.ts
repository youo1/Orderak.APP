// ============================================================
// Public landing page for orderak.app (and www.orderak.app).
//
// Served at GET "/" on the public hosts only. The admin host
// (admin.orderak.app) keeps serving the panel at "/", and the
// API host keeps its JSON behaviour — see index.ts routing.
//
// Self-contained: no external CSS/JS/fonts so it loads instantly
// on the Cloudflare edge with zero extra requests. Arabic-first
// (RTL) to match the seller catalog pages, EGP market focus.
// ============================================================

import type { Theme } from "./domains/design/theme";

/** The full HTML for the Orderak marketing landing page. */
export function landingPageHtml(t: Theme, generatedCss = "", fontPreload = ""): string {
	return `<!doctype html>
<html lang="ar" dir="rtl"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>أوردرك Orderak — استقبل طلبات عملائك بسهولة</title>
<meta name="description" content="أوردرك: تطبيق ورابط بسيط يتيح لعملائك طلب منتجاتك واختيار طريقة الدفع. جرّبه مجانًا.">
<meta name="theme-color" content="${t.primary}">
<meta property="og:title" content="أوردرك Orderak">
<meta property="og:description" content="استقبل طلبات عملائك عبر الإنترنت بسهولة، دون موقع إلكتروني.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://orderak.app/">
${fontPreload}
<link rel="icon" href="/static/orderak-favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="apple-touch-icon" href="/static/orderak-icon-180.png">
<link rel="manifest" href="/manifest.json">
<meta property="og:image" content="https://orderak.app/static/orderak-icon-512.png">
<style>${generatedCss}
	:root{--g:${t.primary};--g2:${t.primary_strong};--bg:${t.canvas};--tx:${t.ink};--muted:${t.muted};--card:${t.surface}}
	*{box-sizing:border-box;margin:0;padding:0}
	html{scroll-behavior:smooth}
	body{font-family:var(--orderak-font-family,system-ui,'Segoe UI',Tahoma,sans-serif);background:var(--bg);color:var(--tx);line-height:1.6}
	.wrap{max-width:1040px;margin:auto;padding:0 20px}
	a{color:inherit;text-decoration:none}
	.btn{display:inline-block;background:var(--g);color:#fff;font-weight:700;padding:14px 28px;border-radius:12px;font-size:17px;transition:background .15s,transform .15s;border:none;cursor:pointer}
	.btn:hover{background:var(--g2);transform:translateY(-1px)}
	.btn.ghost{background:transparent;color:var(--g);border:2px solid var(--g);padding:12px 26px}

	/* Header */
	header{position:sticky;top:0;background:rgba(250,248,245,.9);backdrop-filter:blur(8px);z-index:10;border-bottom:1px solid #0000000d}
	.nav{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;max-width:1040px;margin:auto}
	.logo{font-size:22px;font-weight:800;color:var(--g)}
	.nav-links{display:flex;gap:22px;align-items:center}
	.nav-links a{color:var(--muted);font-weight:600;font-size:15px}
	.nav-links a:hover{color:var(--tx)}
	@media(max-width:640px){.nav-links a:not(.btn){display:none}}

	/* Hero */
	.hero{text-align:center;padding:70px 0 56px}
	.hero h1{font-size:clamp(30px,6vw,52px);font-weight:800;line-height:1.2;margin-bottom:18px}
	.hero h1 span{color:var(--g)}
	.hero p{font-size:clamp(17px,2.5vw,21px);color:var(--muted);max-width:620px;margin:0 auto 30px}
	.hero-actions{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
	.badge{display:inline-block;background:#E8F7EF;color:var(--g2);font-weight:700;font-size:14px;padding:6px 16px;border-radius:999px;margin-bottom:22px}

	/* Sections */
	section{padding:56px 0}
	.sec-title{text-align:center;font-size:clamp(24px,4vw,34px);font-weight:800;margin-bottom:12px}
	.sec-sub{text-align:center;color:var(--muted);max-width:560px;margin:0 auto 40px;font-size:17px}

	/* Features grid */
	.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px}
	.feature{background:var(--card);border-radius:16px;padding:26px;box-shadow:0 2px 10px #0000000a;border:1px solid #0000000a}
	.feature .ico{font-size:34px;margin-bottom:12px}
	.feature h3{font-size:19px;margin-bottom:8px}
	.feature p{color:var(--muted);font-size:15px}

	/* Steps */
	.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;counter-reset:step}
	.step{position:relative;background:var(--card);border-radius:16px;padding:26px 22px;box-shadow:0 2px 10px #0000000a}
	.step::before{counter-increment:step;content:counter(step);display:flex;align-items:center;justify-content:center;width:40px;height:40px;background:var(--g);color:#fff;border-radius:50%;font-weight:800;font-size:19px;margin-bottom:14px}
	.step h3{font-size:18px;margin-bottom:6px}
	.step p{color:var(--muted);font-size:15px}

	/* Pricing */
	.pricing{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;align-items:stretch}
	.plan{background:var(--card);border-radius:18px;padding:30px 26px;box-shadow:0 2px 12px #0000000d;border:2px solid transparent;display:flex;flex-direction:column}
	.plan.pop{border-color:var(--g);position:relative}
	.plan.pop::after{content:'الأكثر طلبًا';position:absolute;top:-13px;inset-inline-start:50%;transform:translateX(50%);background:var(--g);color:#fff;font-size:13px;font-weight:700;padding:4px 14px;border-radius:999px}
	.plan h3{font-size:21px;margin-bottom:6px}
	.plan .price{font-size:36px;font-weight:800;color:var(--g);margin:8px 0}
	.plan .price small{font-size:15px;color:var(--muted);font-weight:600}
	.plan ul{list-style:none;margin:16px 0 24px;text-align:start;flex:1}
	.plan li{padding:7px 0;color:var(--muted);font-size:15px}
	.plan li::before{content:'✓';color:var(--g);font-weight:800;margin-inline-end:8px}
	.plan .btn{width:100%;text-align:center}

	/* CTA */
	.cta{background:var(--g);color:#fff;border-radius:22px;text-align:center;padding:56px 24px;margin:20px 0}
	.cta h2{font-size:clamp(24px,4vw,34px);font-weight:800;margin-bottom:12px}
	.cta p{opacity:.95;font-size:18px;margin-bottom:26px}
	.cta .btn{background:#fff;color:var(--g)}
	.cta .btn:hover{background:#f0f0f0}

	/* Footer */
	footer{border-top:1px solid #0000000d;padding:32px 0;text-align:center;color:var(--muted);font-size:14px}
	.foot-links{display:flex;gap:20px;justify-content:center;flex-wrap:wrap;margin-bottom:14px}
	.foot-links a{color:var(--muted);font-weight:600}
	.foot-links a:hover{color:var(--g)}
</style></head><body>

<header>
	<nav class="nav">
		<a href="#top" class="logo">🛍️ أوردرك</a>
		<div class="nav-links">
			<a href="#features">المميزات</a>
			<a href="#how">طريقة العمل</a>
			<a href="#pricing">الباقات</a>
			<a href="#download" class="btn">حمّل التطبيق</a>
		</div>
	</nav>
</header>

<main id="top">

	<!-- Hero -->
	<div class="wrap">
		<section class="hero">
			<span class="badge">🚀 ابدأ مجانًا</span>
			<h1>استقبل <span>طلبات عملائك</span> عبر الإنترنت<br>دون موقع إلكتروني ودون عناء</h1>
			<p>يمنحك أوردرك رابطًا بسيطًا ترسله إلى عملائك، فيختارون منتجاتهم ويحددون طريقة الدفع، ويصلك الطلب مباشرةً على تطبيقك.</p>
			<div class="hero-actions">
				<a href="#download" class="btn">ابدأ مجانًا الآن</a>
				<a href="#how" class="btn ghost">تعرّف على طريقة العمل</a>
			</div>
		</section>
	</div>

	<!-- Features -->
	<div class="wrap">
		<section id="features">
			<h2 class="sec-title">كل ما يحتاجه متجرك</h2>
			<p class="sec-sub">أدوات بسيطة تجعل البيع عبر الإنترنت أسهل، دون أي خبرة تقنية.</p>
			<div class="grid">
				<div class="feature"><div class="ico">🔗</div><h3>رابط متجر جاهز</h3><p>صفحة منتجات أنيقة بالعربية على رابط خاص بك، تشاركه في أي مكان.</p></div>
				<div class="feature"><div class="ico">💳</div><h3>دفع محلي</h3><p>نقدًا عند الاستلام أو عبر إنستاباي أو محفظة إلكترونية، بحسب ما يفضّله عميلك.</p></div>
				<div class="feature"><div class="ico">📱</div><h3>تطبيق أندرويد</h3><p>تصلك الطلبات لحظيًا على هاتفك مع تفاصيل العميل والمنتجات.</p></div>
				<div class="feature"><div class="ico">📦</div><h3>إدارة المخزون</h3><p>تتحدّث الكميات تلقائيًا مع كل طلب، فلا يُباع منتج نفد من المخزون.</p></div>
				<div class="feature"><div class="ico">🎁</div><h3>كوبونات وإحالات</h3><p>قدّم خصومات لعملائك واستفد من نظام دعوة الأصدقاء.</p></div>
				<div class="feature"><div class="ico">🤖</div><h3>مساعد ذكي</h3><p>ذكاء اصطناعي يساعدك في الردود وترتيب الطلبات واقتراحات القائمة.</p></div>
			</div>
		</section>
	</div>

	<!-- How it works -->
	<div class="wrap">
		<section id="how">
			<h2 class="sec-title">ابدأ في ثلاث خطوات</h2>
			<p class="sec-sub">من التسجيل حتى أول طلب في دقائق معدودة.</p>
			<div class="steps">
				<div class="step"><h3>سجّل متجرك</h3><p>حمّل التطبيق وأدخل رقم هاتفك واسم متجرك، فيصبح رابطك جاهزًا.</p></div>
				<div class="step"><h3>أضف منتجاتك</h3><p>أضف الأصناف والأسعار والكميات، ثم أرسل الرابط إلى عملائك.</p></div>
				<div class="step"><h3>استقبل واقبض</h3><p>يطلب العميل ويحدد طريقة الدفع، ويصلك الطلب فورًا جاهزًا للتحضير.</p></div>
			</div>
		</section>
	</div>

	<!-- Pricing -->
	<div class="wrap">
		<section id="pricing">
			<h2 class="sec-title">ابدأ مجانًا</h2>
			<p class="sec-sub">تبدأ بباقة مجانية، وتجد في التطبيق الباقات المتاحة وما تضيفه كل باقة.</p>
			<div class="pricing">
				<div class="plan pop">
					<h3>مجانًا</h3>
					<ul>
						<li>رابط متجر خاص بك</li>
						<li>استقبال الطلبات</li>
						<li>النقد عند الاستلام وإنستاباي والمحافظ الإلكترونية</li>
						<li>الباقات الأعلى تُعرض داخل التطبيق</li>
					</ul>
					<a href="#download" class="btn">ابدأ مجانًا</a>
				</div>
			</div>
		</section>
	</div>

	<!-- CTA -->
	<div class="wrap">
		<section id="download">
			<div class="cta">
				<h2>هل أنت مستعد للبيع عبر الإنترنت؟</h2>
				<p>حمّل تطبيق أوردرك الآن واستقبل أول طلب اليوم.</p>
				<a href="https://api.orderak.app/health" class="btn">حمّل تطبيق أندرويد 📲</a>
			</div>
		</section>
	</div>

</main>

<footer>
	<div class="wrap">
		<div class="foot-links">
			<a href="#features">المميزات</a>
			<a href="#pricing">الباقات</a>
			<a href="#how">طريقة العمل</a>
			<a href="https://api.orderak.app/admin">لوحة التحكم</a>
		</div>
		<div>© 2026 أوردرك Orderak — جميع الحقوق محفوظة.</div>
	</div>
</footer>

</body></html>`;
}
