// ============================================================
// Default email templates (code = source of truth).
//
// The admin "Emails" tab stores OVERRIDES in D1; when a (key, lang)
// override is missing, EmailService falls back to the seed here.
//
// Bodies use {{variable}} tokens rendered by renderer.ts. Keep them
// simple, inline-styled HTML (best email-client compatibility) plus
// a plain-text alternative for deliverability/accessibility.
// ============================================================

export type TemplateCategory = "auth" | "billing" | "orders" | "marketing" | "support" | "admin";

export interface SeedTranslation {
	subject: string;
	html: string;
	text: string;
}

export interface SeedTemplate {
	key: string;
	category: TemplateCategory;
	translations: {
		ar: SeedTranslation;
		en: SeedTranslation;
		fr?: SeedTranslation;
	};
}

/** Wrap body HTML in a minimal, RTL-aware branded shell. */
function layout(dir: "rtl" | "ltr", bodyHtml: string): string {
	const align = dir === "rtl" ? "right" : "left";
	return `<!doctype html>
<html dir="${dir}">
<body style="margin:0;background:#F5F6F8;font-family:system-ui,'Segoe UI',Tahoma,Arial">
  <div style="max-width:520px;margin:0 auto;padding:24px">
    <div style="text-align:center;padding:8px 0 16px">
      <span style="font-size:22px;font-weight:800;color:#1DAB61">🛍️ Orderak</span>
    </div>
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:24px;text-align:${align};color:#1C1B1A;line-height:1.7">
      ${bodyHtml}
    </div>
    <p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:16px">
      © Orderak · <a href="https://orderak.app" style="color:#1DAB61;text-decoration:none">orderak.app</a>
    </p>
  </div>
</body>
</html>`;
}

const btn = (dir: "rtl" | "ltr", label: string, url: string) =>
	`<div style="text-align:center;margin:20px 0">
     <a href="${url}" style="background:#1DAB61;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;display:inline-block">${label}</a>
   </div>`;

// ---------------------------------------------------------------------------
// MVP templates (flows that already exist in the codebase).
// ---------------------------------------------------------------------------

export const SEED_TEMPLATES: SeedTemplate[] = [
	{
		key: "account_email_verification",
		category: "auth",
		translations: {
			ar: {
				subject: "تحقق من بريد حسابك في أوردرَك",
				html: layout(
					"rtl",
					`<h2 style="margin:0 0 12px;font-size:18px">مرحبًا {{name|بك}}</h2>
					 <p>استخدم هذا الرابط للتحقق من بريد حسابك الخاص في أوردرَك.</p>
					 ${btn("rtl", "تحقق من البريد", "{{verify_url}}")}
					 <p style="color:#6b7280;font-size:13px">تنتهي صلاحية الرابط خلال {{expires_hours}} ساعة. هذا البريد مخصص للفواتير وتنبيهات الحساب، وليس وسيلة لاسترداد الحساب.</p>`,
				),
				text: "مرحبًا {{name|بك}}\n\nتحقق من بريد حسابك: {{verify_url}}\n\nتنتهي صلاحية الرابط خلال {{expires_hours}} ساعة. البريد ليس وسيلة لاسترداد الحساب.",
			},
			en: {
				subject: "Verify your Orderak account email",
				html: layout(
					"ltr",
					`<h2 style="margin:0 0 12px;font-size:18px">Hello {{name|there}}</h2>
					 <p>Use this link to verify your private Orderak account email.</p>
					 ${btn("ltr", "Verify email", "{{verify_url}}")}
					 <p style="color:#6b7280;font-size:13px">The link expires in {{expires_hours}} hours. This email is for invoices and account notices; it is not an account-recovery method.</p>`,
				),
				text: "Hello {{name|there}}\n\nVerify your account email: {{verify_url}}\n\nThe link expires in {{expires_hours}} hours. Email is not an account-recovery method.",
			},
			fr: {
				subject: "Vérifiez l’adresse e-mail de votre compte Orderak",
				html: layout(
					"ltr",
					`<h2 style="margin:0 0 12px;font-size:18px">Bonjour {{name|}}</h2>
					 <p>Utilisez ce lien pour vérifier l’adresse e-mail privée de votre compte Orderak.</p>
					 ${btn("ltr", "Vérifier l’adresse", "{{verify_url}}")}
					 <p style="color:#6b7280;font-size:13px">Le lien expire dans {{expires_hours}} heures. Cette adresse sert aux factures et notifications, pas à la récupération du compte.</p>`,
				),
				text: "Bonjour {{name|}}\n\nVérifiez votre adresse e-mail : {{verify_url}}\n\nLe lien expire dans {{expires_hours}} heures. L’e-mail ne permet pas de récupérer le compte.",
			},
		},
	},
	{
		key: "admin_password_reset",
		category: "auth",
		translations: {
			ar: {
				subject: "إعادة تعيين كلمة مرور أوردرك",
				html: layout(
					"rtl",
					`<h2 style="margin:0 0 12px;font-size:18px">مرحبًا {{name|المشرف}}</h2>
					 <p>وصلنا طلب لإعادة تعيين كلمة المرور لحسابك في أوردرك.</p>
					 <p>استخدم الرمز التالي أو اضغط على الزر لإكمال العملية:</p>
					 <p style="font-size:26px;font-weight:800;letter-spacing:3px;text-align:center;color:#1DAB61">{{code}}</p>
					 ${btn("rtl", "إعادة تعيين كلمة المرور", "{{reset_url}}")}
					 <p style="color:#6b7280;font-size:13px">إذا لم تطلب ذلك، تجاهل هذه الرسالة. ينتهي الرمز خلال 30 دقيقة.</p>`,
				),
				text: "مرحبًا {{name|المشرف}}\n\nرمز إعادة تعيين كلمة المرور: {{code}}\nأو افتح: {{reset_url}}\n\nإذا لم تطلب ذلك، تجاهل هذه الرسالة. ينتهي الرمز خلال 30 دقيقة.",
			},
			en: {
				subject: "Reset your Orderak password",
				html: layout(
					"ltr",
					`<h2 style="margin:0 0 12px;font-size:18px">Hello {{name|Admin}}</h2>
					 <p>We received a request to reset your Orderak admin password.</p>
					 <p>Use the code below or click the button to continue:</p>
					 <p style="font-size:26px;font-weight:800;letter-spacing:3px;text-align:center;color:#1DAB61">{{code}}</p>
					 ${btn("ltr", "Reset password", "{{reset_url}}")}
					 <p style="color:#6b7280;font-size:13px">If you didn't request this, ignore this email. The code expires in 30 minutes.</p>`,
				),
				text: "Hello {{name|Admin}}\n\nYour password reset code: {{code}}\nOr open: {{reset_url}}\n\nIf you didn't request this, ignore this email. The code expires in 30 minutes.",
			},
		},
	},
	{
		key: "admin_login_alert",
		category: "auth",
		translations: {
			ar: {
				subject: "تنبيه تسجيل دخول جديد إلى أوردرك",
				html: layout(
					"rtl",
					`<h2 style="margin:0 0 12px;font-size:18px">مرحبًا {{name|المشرف}}</h2>
					 <p>تم تسجيل الدخول إلى حسابك في لوحة تحكم أوردرك.</p>
					 <p><b>الوقت:</b> {{time}}<br><b>عنوان IP:</b> {{ip|غير معروف}}</p>
					 <p style="color:#6b7280;font-size:13px">إذا كنت أنت، فلا داعي لأي إجراء. إن لم تكن أنت، غيّر كلمة المرور فورًا.</p>`,
				),
				text: "مرحبًا {{name|المشرف}}\n\nتم تسجيل الدخول إلى حسابك في أوردرك.\nالوقت: {{time}}\nIP: {{ip|غير معروف}}\n\nإن لم تكن أنت، غيّر كلمة المرور فورًا.",
			},
			en: {
				subject: "New sign-in to your Orderak admin",
				html: layout(
					"ltr",
					`<h2 style="margin:0 0 12px;font-size:18px">Hello {{name|Admin}}</h2>
					 <p>Your Orderak admin account was just signed in to.</p>
					 <p><b>Time:</b> {{time}}<br><b>IP address:</b> {{ip|unknown}}</p>
					 <p style="color:#6b7280;font-size:13px">If this was you, no action is needed. If not, change your password immediately.</p>`,
				),
				text: "Hello {{name|Admin}}\n\nYour Orderak admin account was just signed in to.\nTime: {{time}}\nIP: {{ip|unknown}}\n\nIf this wasn't you, change your password immediately.",
			},
		},
	},
	{
		key: "invoice",
		category: "billing",
		translations: {
			ar: {
				subject: "إيصال دفع أوردرك — {{plan}}",
				html: layout(
					"rtl",
					`<h2 style="margin:0 0 12px;font-size:18px">شكرًا {{name|عميلنا العزيز}}</h2>
					 <p>تم استلام دفعتك بنجاح. تفاصيل الاشتراك:</p>
					 <table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0">
					   <tr><td style="padding:6px 0;color:#6b7280">الخطة</td><td style="text-align:left"><b>{{plan}}</b></td></tr>
					   <tr><td style="padding:6px 0;color:#6b7280">المبلغ</td><td style="text-align:left"><b>{{amount}} ج.م</b></td></tr>
					   <tr><td style="padding:6px 0;color:#6b7280">رقم العملية</td><td style="text-align:left">{{invoice_id}}</td></tr>
					   <tr><td style="padding:6px 0;color:#6b7280">التاريخ</td><td style="text-align:left">{{date}}</td></tr>
					 </table>
					 <p style="color:#6b7280;font-size:13px">احتفظ بهذا الإيصال في سجلاتك.</p>`,
				),
				text: "شكرًا {{name|عميلنا العزيز}}\n\nتم استلام دفعتك.\nالخطة: {{plan}}\nالمبلغ: {{amount}} ج.م\nرقم العملية: {{invoice_id}}\nالتاريخ: {{date}}",
			},
			en: {
				subject: "Your Orderak receipt — {{plan}}",
				html: layout(
					"ltr",
					`<h2 style="margin:0 0 12px;font-size:18px">Thank you, {{name|customer}}</h2>
					 <p>Your payment was received successfully. Subscription details:</p>
					 <table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0">
					   <tr><td style="padding:6px 0;color:#6b7280">Plan</td><td style="text-align:right"><b>{{plan}}</b></td></tr>
					   <tr><td style="padding:6px 0;color:#6b7280">Amount</td><td style="text-align:right"><b>{{amount}} EGP</b></td></tr>
					   <tr><td style="padding:6px 0;color:#6b7280">Invoice ID</td><td style="text-align:right">{{invoice_id}}</td></tr>
					   <tr><td style="padding:6px 0;color:#6b7280">Date</td><td style="text-align:right">{{date}}</td></tr>
					 </table>
					 <p style="color:#6b7280;font-size:13px">Please keep this receipt for your records.</p>`,
				),
				text: "Thank you, {{name|customer}}\n\nYour payment was received.\nPlan: {{plan}}\nAmount: {{amount}} EGP\nInvoice ID: {{invoice_id}}\nDate: {{date}}",
			},
		},
	},
];

/** Quick lookup: key -> seed template. */
export const SEED_BY_KEY: Record<string, SeedTemplate> = Object.fromEntries(
	SEED_TEMPLATES.map((t) => [t.key, t]),
);
