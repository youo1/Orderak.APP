// French (fr) dictionary. Keys are dotted; used by t(lang, key, vars).
//
// WHY THIS FILE EXISTS
//   The Android app has shipped `fr` as a selectable UI language since the
//   locale picker was built — AppLocales.supported lists it, values-fr/ carries
//   the full string set, and `Accept-Language: fr` goes out on every request.
//   This module's LOCALES held only ["ar", "en"], so localeFromAcceptLanguage
//   found no match and pickLocale fell through to DEFAULT_LOCALE, which is
//   Arabic. A French-speaking seller was answered in Arabic by the server, by
//   the email templates, and — the part that mattered — by currentLegalVersion,
//   whose ORDER BY prefers the requested locale. The consent row written into
//   legal_acceptances therefore recorded that they had accepted the Arabic
//   terms.
//
//   The rest of the backend already treated French as first-class: geo.ts and
//   business-taxonomy.ts both carry it in SUPPORTED_LANGS, the email repository
//   types Lang as "ar" | "en" | "fr", and the admin content surface accepts it.
//   This dictionary is what the core i18n module was missing.
//
// ON LEGAL VERSIONS
//   content_page_versions holds ar and en rows. currentLegalVersion falls back
//   requested -> en -> anything, so a French seller now lands on the English
//   terms rather than the Arabic ones. That is a better answer than before and
//   still not the right one; publishing French terms is a content task, tracked
//   separately from this file.
export const fr: Record<string, string> = {
	// generic / errors
	"errors.auth": "Numéro ou code secret incorrect.",
	"errors.unauthorized": "Non autorisé.",
	"errors.forbidden": "Vous n'avez pas la permission de faire cela.",
	"errors.not_found": "Introuvable.",
	"errors.server": "Une erreur est survenue. Veuillez réessayer.",
	"errors.invalid_json": "Corps de requête invalide.",
	"errors.rate_limited": "Trop de requêtes. Veuillez ralentir.",
	"errors.maintenance": "Orderak est en maintenance. Réessayez bientôt.",
	"errors.signups_closed": "Les nouvelles inscriptions sont temporairement fermées.",
	"errors.account_suspended": "Votre compte est suspendu. Contactez le support.",

	// slugs
	"slug.taken": "Ce lien est déjà pris.",
	"slug.invalid": "Le lien doit comporter au moins 3 caractères (lettres, chiffres, tirets).",
	"slug.reserved": "Ce lien est réservé et ne peut pas être utilisé.",

	// coupons
	"coupons.invalid": "Ce code promo n'est pas valide.",
	"coupons.expired": "Ce code promo a expiré.",
	"coupons.max_uses": "Ce code promo a atteint sa limite d'utilisation.",
	"coupons.already_used": "Vous avez déjà utilisé ce code promo.",
	"coupons.applied": "Code promo appliqué. Vous avez économisé {amount} EGP.",

	// subscriptions
	"subs.free_activated": "Votre offre gratuite est active.",
	"subs.pending": "Terminez votre paiement pour activer l'offre.",
	"subs.canceled": "Votre abonnement a été annulé.",
	"subs.not_found": "Aucun abonnement trouvé.",

	// referral
	"referral.applied": "Code de parrainage appliqué.",
	"referral.invalid": "Code de parrainage invalide.",
	"referral.self": "Vous ne pouvez pas utiliser votre propre code de parrainage.",
	"referral.already": "Un parrainage est déjà enregistré pour ce compte.",

	// admin auth
	"admin.login.bad": "E-mail ou mot de passe incorrect.",
	"admin.login.mfa_required": "Saisissez votre code d'authentification à 6 chiffres.",
	"admin.login.mfa_bad": "Code d'authentification incorrect.",
	"admin.login.ok": "Bon retour parmi nous.",
	"admin.password.changed": "Mot de passe mis à jour.",
	"admin.password.weak": "Le mot de passe doit comporter au moins 8 caractères.",
	"admin.password.wrong_current": "Votre mot de passe actuel est incorrect.",

	// admin ui labels
	"admin.nav.dashboard": "Tableau de bord",
	"admin.nav.sellers": "Vendeurs",
	"admin.nav.subscriptions": "Abonnements",
	"admin.nav.plans": "Offres",
	"admin.nav.coupons": "Codes promo",
	"admin.nav.affiliate": "Affiliation",
	"admin.nav.payouts": "Versements",
	"admin.nav.ads": "Publicités",
	"admin.nav.content": "Contenu",
	"admin.nav.announcements": "Annonces",
	"admin.nav.support": "Support",
	"admin.nav.ai": "IA",
	"admin.nav.settings": "Paramètres",
	"admin.nav.admins": "Administrateurs",
	"admin.nav.audit": "Journal d'audit",
	"admin.logout": "Se déconnecter",

	// public catalog
	"catalog.whatsapp": "WhatsApp",
	"catalog.email": "E-mail",
	"catalog.website": "Site web",
	"catalog.empty": "Aucun produit n'est disponible pour le moment.",
	"catalog.category_empty": "Aucun produit n'est disponible dans cette catégorie.",
	"catalog.total": "Total",
	"catalog.currency": "EGP",
	"catalog.phone": "Votre numéro de mobile (WhatsApp)",
	"catalog.phone_placeholder": "Numéro de mobile",
	"catalog.name": "Votre nom",
	"catalog.name_placeholder": "Nom",
	"catalog.note": "Adresse / remarques",
	"catalog.payment": "Mode de paiement",
	"catalog.vfcash": "Vodafone Cash",
	"catalog.instapay": "InstaPay",
	"catalog.cod": "Paiement à la livraison",
	"catalog.submit": "Confirmer la commande ✅",
	"catalog.select_product": "Sélectionnez au moins un produit.",
	"catalog.wait": "Veuillez patienter...",
	"catalog.order_error": "Nous n'avons pas pu enregistrer la commande. Vérifiez le numéro de mobile et les quantités.",
	"catalog.stock_changed": "Le stock a changé pendant votre commande. Vérifiez les quantités et réessayez.",
	"catalog.payment_unavailable": "Ce mode de paiement n'est plus disponible. Choisissez-en un autre.",
	"catalog.rate_limited": "Trop de tentatives. Attendez une minute, puis réessayez.",
	"catalog.network_error": "La connexion a été interrompue. Votre commande n'a pas été dupliquée ; réessayez.",
	"catalog.decrease": "Diminuer la quantité",
	"catalog.increase": "Augmenter la quantité",
	"catalog.order_success": "Votre commande a été enregistrée",
	"catalog.order_number": "Numéro de commande",
	"catalog.payment_proof": "Envoyer la preuve de paiement sur WhatsApp 📲",
	"catalog.sold_out": "Actuellement indisponible",
	"catalog.shop_description": "Achetez en ligne chez {store} et commandez directement.",
	"catalog.category_description": "Parcourez {category} chez {store}.",
	"catalog.powered_by": "Propulsé par",
};
