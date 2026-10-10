import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'
import PHRASES from './phrases.js'

export const LANGS = [
  { code: 'ar', name: 'العربية', dir: 'rtl', locale: 'ar-KW' },
  { code: 'en', name: 'English', dir: 'ltr', locale: 'en-GB' },
  { code: 'ne', name: 'नेपाली', dir: 'ltr', locale: 'ne-NP' },
  { code: 'hi', name: 'हिन्दी', dir: 'ltr', locale: 'hi-IN' },
]

// Employee-facing text only. Admin screens stay in Arabic.
const D = {
  // login
  login_sub: { ar: 'سجّل دخولك برقم هاتفك', en: 'Sign in with your phone number', ne: 'आफ्नो फोन नम्बरले लग इन गर्नुहोस्', hi: 'अपने फ़ोन नंबर से लॉग इन करें' },
  activate_sub: { ar: 'فعّل حسابك بالرمز اللي وصلك من الإدارة', en: 'Activate your account with the code from management', ne: 'व्यवस्थापनबाट पाएको कोडले खाता सक्रिय गर्नुहोस्', hi: 'प्रबंधन से मिले कोड से अपना खाता सक्रिय करें' },
  phone: { ar: 'رقم الهاتف', en: 'Phone number', ne: 'फोन नम्बर', hi: 'फ़ोन नंबर' },
  password: { ar: 'كلمة السر', en: 'Password', ne: 'पासवर्ड', hi: 'पासवर्ड' },
  choose_password: { ar: 'اختار كلمة سر', en: 'Choose a password', ne: 'पासवर्ड छान्नुहोस्', hi: 'पासवर्ड चुनें' },
  code6: { ar: 'رمز التفعيل (٦ أرقام)', en: 'Activation code (6 digits)', ne: 'सक्रियता कोड (६ अङ्क)', hi: 'सक्रियण कोड (6 अंक)' },
  sign_in: { ar: 'دخول', en: 'Sign in', ne: 'लग इन', hi: 'लॉग इन' },
  activate_and_sign_in: { ar: 'تفعيل ودخول', en: 'Activate & sign in', ne: 'सक्रिय गरेर लग इन', hi: 'सक्रिय करें और लॉग इन करें' },
  first_time: { ar: 'أول مرة؟ فعّل حسابك', en: 'First time? Activate your account', ne: 'पहिलो पटक? खाता सक्रिय गर्नुहोस्', hi: 'पहली बार? अपना खाता सक्रिय करें' },
  have_account: { ar: 'عندي حساب، أبي أدخل', en: 'I already have an account', ne: 'मेरो खाता छ, लग इन गर्छु', hi: 'मेरा खाता है, लॉग इन करूँ' },
  wait: { ar: 'لحظة…', en: 'Please wait…', ne: 'कृपया पर्खनुहोस्…', hi: 'कृपया प्रतीक्षा करें…' },
  err_login: { ar: 'رقم الهاتف أو كلمة السر غلط', en: 'Wrong phone number or password', ne: 'फोन नम्बर वा पासवर्ड गलत छ', hi: 'फ़ोन नंबर या पासवर्ड गलत है' },
  change_pw_title: { ar: 'غيّر كلمة السر', en: 'Change your password', ne: 'पासवर्ड परिवर्तन गर्नुहोस्', hi: 'अपना पासवर्ड बदलें' },
  change_pw_sub: { ar: 'لأمان حسابك، اختار كلمة سر جديدة قبل ما تبدأ.', en: 'For your security, choose a new password before you start.', ne: 'तपाईंको सुरक्षाका लागि सुरु गर्नु अघि नयाँ पासवर्ड छान्नुहोस्।', hi: 'आपकी सुरक्षा के लिए, शुरू करने से पहले नया पासवर्ड चुनें।' },
  new_password: { ar: 'كلمة السر الجديدة', en: 'New password', ne: 'नयाँ पासवर्ड', hi: 'नया पासवर्ड' },
  confirm_password: { ar: 'أعد كتابة كلمة السر', en: 'Repeat the password', ne: 'पासवर्ड फेरि लेख्नुहोस्', hi: 'पासवर्ड दोबारा लिखें' },
  pw_mismatch: { ar: 'كلمتين السر مو متطابقتين', en: 'The passwords do not match', ne: 'पासवर्ड मेल खाएन', hi: 'पासवर्ड मेल नहीं खाते' },
  pw_not_phone: { ar: 'لازم تكون غير رقم هاتفك، و٦ أحرف على الأقل', en: 'It must be different from your phone number and at least 6 characters', ne: 'फोन नम्बरभन्दा फरक र कम्तीमा ६ अक्षरको हुनुपर्छ', hi: 'यह फ़ोन नंबर से अलग और कम से कम 6 अक्षर का होना चाहिए' },
  save_continue: { ar: 'حفظ ومتابعة', en: 'Save & continue', ne: 'सेभ गरेर अगाडि बढ्नुहोस्', hi: 'सहेजें और जारी रखें' },
  first_login_hint: { ar: 'أول مرة؟ كلمة السر هي رقم هاتفك.', en: 'First time? Your password is your phone number.', ne: 'पहिलो पटक? पासवर्ड तपाईंको फोन नम्बर हो।', hi: 'पहली बार? पासवर्ड आपका फ़ोन नंबर है।' },
  ot_hours: { ar: '{n} ساعة', en: '{n} h', ne: '{n} घण्टा', hi: '{n} घंटे' },
  ot_month: { ar: 'إضافي هالشهر', en: 'Overtime this month', ne: 'यो महिनाको ओभरटाइम', hi: 'इस महीने ओवरटाइम' },
  ot_approved: { ar: 'معتمد: {n} ساعة', en: 'Approved: {n} h', ne: 'स्वीकृत: {n} घण्टा', hi: 'स्वीकृत: {n} घंटे' },
  ot_pending: { ar: 'ينتظر الموافقة: {n} ساعة', en: 'Pending: {n} h', ne: 'बाँकी: {n} घण्टा', hi: 'लंबित: {n} घंटे' },
  language: { ar: 'اللغة', en: 'Language', ne: 'भाषा', hi: 'भाषा' },
  loading: { ar: 'جاري التحميل…', en: 'Loading…', ne: 'लोड हुँदैछ…', hi: 'लोड हो रहा है…' },
  logout: { ar: 'تسجيل خروج', en: 'Sign out', ne: 'लग आउट', hi: 'लॉग आउट' },
  not_active: { ar: 'حسابك غير مفعّل. تواصل مع الإدارة.', en: 'Your account is not active. Please contact management.', ne: 'तपाईंको खाता सक्रिय छैन। व्यवस्थापनलाई सम्पर्क गर्नुहोस्।', hi: 'आपका खाता सक्रिय नहीं है। कृपया प्रबंधन से संपर्क करें।' },

  // nav
  nav_home: { ar: 'الرئيسية', en: 'Home', ne: 'गृहपृष्ठ', hi: 'होम' },
  nav_docs: { ar: 'مستنداتي', en: 'My documents', ne: 'मेरा कागजात', hi: 'मेरे दस्तावेज़' },
  nav_leaves: { ar: 'الإجازات', en: 'Leave', ne: 'बिदा', hi: 'छुट्टी' },
  nav_corrections: { ar: 'نسيان البصمة', en: 'Missed punch', ne: 'छुटेको हाजिरी', hi: 'छूटी हाज़िरी' },
  nav_payslips: { ar: 'كشوف راتبي', en: 'My payslips', ne: 'मेरो तलब विवरण', hi: 'मेरी सैलरी स्लिप' },
  nav_notices: { ar: 'العقوبات والإنذارات', en: 'Warnings & notices', ne: 'चेतावनी र सूचना', hi: 'चेतावनी और नोटिस' },
  nav_notifications: { ar: 'التنبيهات', en: 'Notifications', ne: 'सूचनाहरू', hi: 'सूचनाएँ' },

  // home
  good_morning: { ar: 'صباح الخير', en: 'Good morning', ne: 'शुभ प्रभात', hi: 'सुप्रभात' },
  good_evening: { ar: 'مساء الخير', en: 'Good evening', ne: 'शुभ साँझ', hi: 'शुभ संध्या' },
  branch: { ar: 'فرع', en: 'Branch', ne: 'शाखा', hi: 'शाखा' },
  no_shift: { ar: 'ما فيه شفت محدد لك', en: 'No shift assigned to you', ne: 'तपाईंलाई सिफ्ट तोकिएको छैन', hi: 'आपको कोई शिफ्ट नहीं दी गई है' },
  check_in: { ar: 'تسجيل حضور', en: 'Check in', ne: 'हाजिरी (आगमन)', hi: 'चेक इन' },
  check_out: { ar: 'تسجيل انصراف', en: 'Check out', ne: 'प्रस्थान', hi: 'चेक आउट' },
  day_done: { ar: 'خلصت دوامك اليوم 👋', en: 'Your day is done 👋', ne: 'आजको काम सकियो 👋', hi: 'आज का काम पूरा 👋' },
  checked_in_ok: { ar: 'تم تسجيل الحضور', en: 'Checked in', ne: 'हाजिरी दर्ता भयो', hi: 'चेक इन हो गया' },
  checked_out_ok: { ar: 'تم تسجيل الانصراف', en: 'Checked out', ne: 'प्रस्थान दर्ता भयो', hi: 'चेक आउट हो गया' },
  late_by: { ar: 'متأخر {n} دقيقة', en: '{n} min late', ne: '{n} मिनेट ढिलो', hi: '{n} मिनट देर' },
  outside_branch: { ar: 'ملاحظة: موقعك خارج الفرع', en: 'Note: you are outside the branch', ne: 'नोट: तपाईं शाखा बाहिर हुनुहुन्छ', hi: 'नोट: आप शाखा से बाहर हैं' },
  already_in: { ar: 'أنت مسجل حضور من قبل', en: 'You are already checked in', ne: 'तपाईंको हाजिरी पहिले नै छ', hi: 'आप पहले से चेक इन हैं' },
  in_time: { ar: 'الحضور', en: 'In', ne: 'आगमन', hi: 'आगमन' },
  out_time: { ar: 'الانصراف', en: 'Out', ne: 'प्रस्थान', hi: 'प्रस्थान' },
  hours: { ar: 'الساعات', en: 'Hours', ne: 'घण्टा', hi: 'घंटे' },
  missed_count: { ar: 'عندك {n} بصمة ناقصة', en: 'You have {n} missing punch(es)', ne: 'तपाईंको {n} हाजिरी छुटेको छ', hi: 'आपकी {n} हाज़िरी छूटी है' },
  send_request: { ar: 'أرسل طلب', en: 'Send request', ne: 'अनुरोध पठाउनुहोस्', hi: 'अनुरोध भेजें' },
  notice_needs_sign: { ar: 'وصلك إشعار من الإدارة يحتاج توقيعك', en: 'You have a notice from management to sign', ne: 'व्यवस्थापनबाट हस्ताक्षर गर्नुपर्ने सूचना आएको छ', hi: 'प्रबंधन से हस्ताक्षर के लिए नोटिस आया है' },
  read: { ar: 'اقرأ', en: 'Read', ne: 'पढ्नुहोस्', hi: 'पढ़ें' },
  request_leave_balance: { ar: 'طلب إجازة · رصيدك {n}', en: 'Request leave · balance {n}', ne: 'बिदा अनुरोध · बाँकी {n}', hi: 'छुट्टी अनुरोध · शेष {n}' },
  forgot_punch: { ar: 'نسيت أبصم', en: 'I forgot to punch', ne: 'हाजिरी गर्न बिर्सें', hi: 'हाज़िरी लगाना भूल गया' },
  doc_expires_in: { ar: '{doc} تنتهي بعد {n} يوم', en: '{doc} expires in {n} days', ne: '{doc} {n} दिनमा समाप्त हुन्छ', hi: '{doc} {n} दिन में समाप्त होगा' },
  doc_is_expired: { ar: '{doc} منتهية', en: '{doc} has expired', ne: '{doc} समाप्त भइसक्यो', hi: '{doc} समाप्त हो चुका है' },
  renew: { ar: 'جدّدها', en: 'Renew', ne: 'नवीकरण', hi: 'नवीनीकरण' },

  // documents
  add_document: { ar: 'إضافة مستند', en: 'Add document', ne: 'कागजात थप्नुहोस्', hi: 'दस्तावेज़ जोड़ें' },
  update_document: { ar: 'تحديث المستند', en: 'Update document', ne: 'कागजात अपडेट', hi: 'दस्तावेज़ अपडेट करें' },
  doc_type: { ar: 'نوع المستند', en: 'Document type', ne: 'कागजातको प्रकार', hi: 'दस्तावेज़ का प्रकार' },
  doc_photo: { ar: 'صورة المستند', en: 'Document photo', ne: 'कागजातको फोटो', hi: 'दस्तावेज़ की फ़ोटो' },
  front: { ar: 'الوجه الأمامي', en: 'Front side', ne: 'अगाडिको भाग', hi: 'सामने का भाग' },
  back: { ar: 'الوجه الخلفي', en: 'Back side', ne: 'पछाडिको भाग', hi: 'पीछे का भाग' },
  expiry_date: { ar: 'تاريخ الانتهاء', en: 'Expiry date', ne: 'समाप्ति मिति', hi: 'समाप्ति तिथि' },
  doc_number: { ar: 'رقم المستند (اختياري)', en: 'Document number (optional)', ne: 'कागजात नम्बर (ऐच्छिक)', hi: 'दस्तावेज़ संख्या (वैकल्पिक)' },
  remind_before: { ar: 'نبّهني قبل الانتهاء بـ', en: 'Remind me before expiry', ne: 'समाप्ति अघि सम्झाउनुहोस्', hi: 'समाप्ति से पहले याद दिलाएँ' },
  week: { ar: 'أسبوع', en: '1 week', ne: '१ हप्ता', hi: '1 सप्ताह' },
  two_weeks: { ar: 'أسبوعين', en: '2 weeks', ne: '२ हप्ता', hi: '2 सप्ताह' },
  month: { ar: 'شهر', en: '1 month', ne: '१ महिना', hi: '1 महीना' },
  two_months: { ar: 'شهرين', en: '2 months', ne: '२ महिना', hi: '2 महीने' },
  or_days: { ar: 'أو عدد أيام:', en: 'or number of days:', ne: 'वा दिनको संख्या:', hi: 'या दिनों की संख्या:' },
  notify_via: { ar: 'يوصل التنبيه عن طريق', en: 'Send the reminder by', ne: 'सूचना कसरी पठाउने', hi: 'रिमाइंडर कैसे भेजें' },
  in_app: { ar: 'إشعار في التطبيق', en: 'App notification', ne: 'एप सूचना', hi: 'ऐप सूचना' },
  email_mgmt: { ar: 'إيميل للإدارة', en: 'Email to management', ne: 'व्यवस्थापनलाई इमेल', hi: 'प्रबंधन को ईमेल' },
  save_document: { ar: 'حفظ المستند', en: 'Save document', ne: 'कागजात सेभ गर्नुहोस्', hi: 'दस्तावेज़ सहेजें' },
  saving: { ar: 'جاري الحفظ…', en: 'Saving…', ne: 'सेभ हुँदैछ…', hi: 'सहेजा जा रहा है…' },
  pick_type_date: { ar: 'اختار نوع المستند وتاريخ الانتهاء', en: 'Choose the document type and expiry date', ne: 'कागजातको प्रकार र समाप्ति मिति छान्नुहोस्', hi: 'दस्तावेज़ का प्रकार और समाप्ति तिथि चुनें' },
  valid: { ar: 'ساري', en: 'Valid', ne: 'मान्य', hi: 'वैध' },
  expiring: { ar: 'قرب ينتهي', en: 'Expiring soon', ne: 'छिट्टै समाप्त', hi: 'जल्द समाप्त' },
  expired: { ar: 'منتهي', en: 'Expired', ne: 'समाप्त', hi: 'समाप्त' },
  in_days: { ar: 'بعد {n} يوم', en: 'in {n} days', ne: '{n} दिनमा', hi: '{n} दिन में' },
  today_exp: { ar: 'ينتهي اليوم', en: 'Expires today', ne: 'आज समाप्त', hi: 'आज समाप्त' },
  expired_ago: { ar: 'منتهي من {n} يوم', en: 'expired {n} days ago', ne: '{n} दिन अघि समाप्त', hi: '{n} दिन पहले समाप्त' },
  expires_on: { ar: 'ينتهي {d}', en: 'Expires {d}', ne: '{d} मा समाप्त', hi: '{d} को समाप्त' },
  expired_on: { ar: 'انتهى {d}', en: 'Expired {d}', ne: '{d} मा समाप्त भयो', hi: '{d} को समाप्त हुआ' },
  more: { ar: 'المزيد', en: 'More', ne: 'थप', hi: 'और' },
  close: { ar: 'إغلاق', en: 'Close', ne: 'बन्द गर्नुहोस्', hi: 'बंद करें' },
  in_review: { ar: 'بانتظار المراجعة', en: 'Under review', ne: 'समीक्षामा', hi: 'समीक्षा में' },
  rejected_doc: { ar: 'مرفوض', en: 'Rejected', ne: 'अस्वीकृत', hi: 'अस्वीकृत' },
  upload_hint: { ar: 'صوّر المستند بس، والنظام يقرا التواريخ بنفسه. بعدها HR يراجعه ويعتمده.', en: 'Just take a photo. The system reads the dates itself, then HR reviews and approves it.', ne: 'कागजातको फोटो मात्र खिच्नुहोस्। प्रणालीले मिति आफैं पढ्छ, त्यसपछि HR ले जाँचेर स्वीकृत गर्छ।', hi: 'बस दस्तावेज़ की फोटो लें। सिस्टम खुद तारीखें पढ़ेगा, फिर HR जाँच कर मंज़ूरी देगा।' },
  reading_doc: { ar: 'جاري قراءة المستند…', en: 'Reading the document…', ne: 'कागजात पढ्दै…', hi: 'दस्तावेज़ पढ़ा जा रहा है…' },
  sent_review: { ar: 'تم الرفع ✓ المستند الحين عند HR للمراجعة، وبيوصلك تنبيه لما ينعتمد.', en: 'Uploaded ✓ HR will review it and you will be notified.', ne: 'अपलोड भयो ✓ HR ले जाँच गर्नेछ र तपाईंलाई सूचना आउनेछ।', hi: 'अपलोड हो गया ✓ HR इसकी जाँच करेगा और आपको सूचना मिलेगी।' },
  renew_doc: { ar: 'رفع نسخة جديدة (تجديد)', en: 'Upload a new copy (renewal)', ne: 'नयाँ प्रति अपलोड (नवीकरण)', hi: 'नई कॉपी अपलोड करें (नवीनीकरण)' },
  reupload: { ar: 'ارفعه من جديد', en: 'Upload again', ne: 'फेरि अपलोड गर्नुहोस्', hi: 'फिर से अपलोड करें' },
  upload_doc: { ar: 'رفع المستند', en: 'Upload document', ne: 'कागजात अपलोड', hi: 'दस्तावेज़ अपलोड करें' },
  doc_type_optional: { ar: 'نوع المستند (اختياري)', en: 'Document type (optional)', ne: 'कागजातको प्रकार (ऐच्छिक)', hi: 'दस्तावेज़ का प्रकार (वैकल्पिक)' },
  need_photo: { ar: 'صوّر المستند أول', en: 'Take a photo of the document first', ne: 'पहिले कागजातको फोटो खिच्नुहोस्', hi: 'पहले दस्तावेज़ की फोटो लें' },
  review_reason: { ar: 'سبب الرفض: {note}', en: 'Reason: {note}', ne: 'कारण: {note}', hi: 'कारण: {note}' },
  no_expiry: { ar: 'بدون تاريخ انتهاء', en: 'No expiry date', ne: 'समाप्ति मिति छैन', hi: 'कोई समाप्ति तिथि नहीं' },
  doc_pending_note: { ar: 'قيد المراجعة عند HR', en: 'Waiting for HR review', ne: 'HR को समीक्षाको पर्खाइमा', hi: 'HR की समीक्षा का इंतज़ार' },
  new_doc: { ar: 'مستند جديد', en: 'New document', ne: 'नयाँ कागजात', hi: 'नया दस्तावेज़' },
  no_docs: { ar: 'ما فيه مستندات', en: 'No documents', ne: 'कुनै कागजात छैन', hi: 'कोई दस्तावेज़ नहीं' },

  // leaves
  leave_title: { ar: 'الإجازات', en: 'Leave', ne: 'बिदा', hi: 'छुट्टी' },
  your_balance: { ar: 'رصيدك: {n} يوم', en: 'Your balance: {n} days', ne: 'तपाईंको बाँकी: {n} दिन', hi: 'आपका शेष: {n} दिन' },
  request_leave: { ar: 'طلب إجازة', en: 'Request leave', ne: 'बिदा अनुरोध', hi: 'छुट्टी का अनुरोध' },
  leave_type: { ar: 'نوع الإجازة', en: 'Leave type', ne: 'बिदाको प्रकार', hi: 'छुट्टी का प्रकार' },
  from: { ar: 'من', en: 'From', ne: 'देखि', hi: 'से' },
  to: { ar: 'إلى', en: 'To', ne: 'सम्म', hi: 'तक' },
  days_n: { ar: '{n} يوم', en: '{n} days', ne: '{n} दिन', hi: '{n} दिन' },
  deducts: { ar: 'تنخصم من الرصيد', en: 'deducted from balance', ne: 'बाँकीबाट घट्छ', hi: 'शेष से कटेगी' },
  not_deducts: { ar: 'ما تنخصم من الرصيد', en: 'not deducted from balance', ne: 'बाँकीबाट घट्दैन', hi: 'शेष से नहीं कटेगी' },
  reason: { ar: 'السبب', en: 'Reason', ne: 'कारण', hi: 'कारण' },
  signature: { ar: 'التوقيع', en: 'Signature', ne: 'हस्ताक्षर', hi: 'हस्ताक्षर' },
  clear: { ar: 'مسح', en: 'Clear', ne: 'मेटाउनुहोस्', hi: 'मिटाएँ' },
  sign_here: { ar: 'وقّع بإصبعك أو بالماوس داخل المربع', en: 'Sign inside the box with your finger or mouse', ne: 'बाकसभित्र औंला वा माउसले हस्ताक्षर गर्नुहोस्', hi: 'बॉक्स में उंगली या माउस से हस्ताक्षर करें' },
  must_sign: { ar: 'لازم توقّع على الطلب', en: 'Please sign the request', ne: 'कृपया अनुरोधमा हस्ताक्षर गर्नुहोस्', hi: 'कृपया अनुरोध पर हस्ताक्षर करें' },
  send: { ar: 'إرسال الطلب', en: 'Send request', ne: 'अनुरोध पठाउनुहोस्', hi: 'अनुरोध भेजें' },
  sending: { ar: 'جاري الإرسال…', en: 'Sending…', ne: 'पठाउँदैछ…', hi: 'भेजा जा रहा है…' },
  no_balance: { ar: 'رصيدك ما يكفي', en: 'Not enough leave balance', ne: 'पर्याप्त बिदा बाँकी छैन', hi: 'पर्याप्त छुट्टी शेष नहीं है' },
  my_requests: { ar: 'طلباتي', en: 'My requests', ne: 'मेरा अनुरोधहरू', hi: 'मेरे अनुरोध' },
  no_requests: { ar: 'ما عندك طلبات', en: 'You have no requests', ne: 'तपाईंको कुनै अनुरोध छैन', hi: 'आपका कोई अनुरोध नहीं है' },
  cancel: { ar: 'إلغاء', en: 'Cancel', ne: 'रद्द गर्नुहोस्', hi: 'रद्द करें' },
  st_pending: { ar: 'بانتظار الموافقة', en: 'Pending approval', ne: 'स्वीकृतिको पर्खाइमा', hi: 'स्वीकृति लंबित' },
  st_approved: { ar: 'مقبولة', en: 'Approved', ne: 'स्वीकृत', hi: 'स्वीकृत' },
  st_rejected: { ar: 'مرفوضة', en: 'Rejected', ne: 'अस्वीकृत', hi: 'अस्वीकृत' },
  st_cancelled: { ar: 'ملغية', en: 'Cancelled', ne: 'रद्द', hi: 'रद्द' },
  mgmt_note: { ar: 'ملاحظة الإدارة', en: 'Management note', ne: 'व्यवस्थापनको टिप्पणी', hi: 'प्रबंधन की टिप्पणी' },

  // corrections
  corr_title: { ar: 'نسيان البصمة', en: 'Missed punch', ne: 'छुटेको हाजिरी', hi: 'छूटी हाज़िरी' },
  corr_sub: { ar: 'لو نسيت تبصم حضور أو انصراف، أرسل طلب للإدارة', en: 'If you forgot to check in or out, send a request to management', ne: 'आगमन वा प्रस्थान हाजिरी बिर्सनुभयो भने व्यवस्थापनलाई अनुरोध पठाउनुहोस्', hi: 'अगर चेक इन या चेक आउट भूल गए, तो प्रबंधन को अनुरोध भेजें' },
  new_request: { ar: 'طلب جديد', en: 'New request', ne: 'नयाँ अनुरोध', hi: 'नया अनुरोध' },
  corr_form: { ar: 'طلب نسيان بصمة', en: 'Missed punch request', ne: 'छुटेको हाजिरी अनुरोध', hi: 'छूटी हाज़िरी अनुरोध' },
  date: { ar: 'التاريخ', en: 'Date', ne: 'मिति', hi: 'तारीख' },
  what_happened: { ar: 'وش صار؟', en: 'What happened?', ne: 'के भयो?', hi: 'क्या हुआ?' },
  k_attended: { ar: 'حضرت ونسيت أبصم', en: 'I worked but forgot to punch', ne: 'काम गरें तर हाजिरी बिर्सें', hi: 'काम किया पर हाज़िरी भूल गया' },
  k_missed_checkout: { ar: 'بصمت حضور ونسيت الانصراف', en: 'I checked in but forgot to check out', ne: 'आगमन गरें तर प्रस्थान बिर्सें', hi: 'चेक इन किया पर चेक आउट भूल गया' },
  k_leave: { ar: 'كنت إجازة', en: 'I was on leave', ne: 'म बिदामा थिएँ', hi: 'मैं छुट्टी पर था' },
  k_sick: { ar: 'كنت مرضي', en: 'I was sick', ne: 'म बिरामी थिएँ', hi: 'मैं बीमार था' },
  k_day_off: { ar: 'كان يوم أوف', en: 'It was my day off', ne: 'मेरो छुट्टीको दिन थियो', hi: 'मेरा ऑफ़ डे था' },
  in_at: { ar: 'وقت الحضور', en: 'Check-in time', ne: 'आगमन समय', hi: 'चेक इन समय' },
  out_at: { ar: 'وقت الانصراف', en: 'Check-out time', ne: 'प्रस्थान समय', hi: 'चेक आउट समय' },
  leave_one_day: { ar: 'يوم واحد ينخصم من رصيد إجازاتك لو انقبل الطلب.', en: 'One day will be deducted from your leave balance if approved.', ne: 'स्वीकृत भएमा बिदाबाट एक दिन घट्नेछ।', hi: 'स्वीकृत होने पर छुट्टी शेष से एक दिन कटेगा।' },
  missing_punches: { ar: 'بصمات ناقصة عندك', en: 'Your missing punches', ne: 'तपाईंका छुटेका हाजिरी', hi: 'आपकी छूटी हाज़िरी' },
  no_punch: { ar: 'ما فيه بصمة', en: 'No punch', ne: 'हाजिरी छैन', hi: 'कोई हाज़िरी नहीं' },
  no_checkout: { ar: 'ما فيه انصراف', en: 'No check-out', ne: 'प्रस्थान छैन', hi: 'चेक आउट नहीं' },
  c_approved: { ar: 'مقبول', en: 'Approved', ne: 'स्वीकृत', hi: 'स्वीकृत' },
  c_rejected: { ar: 'مرفوض', en: 'Rejected', ne: 'अस्वीकृत', hi: 'अस्वीकृत' },

  // notices
  notices_title: { ar: 'العقوبات والإنذارات', en: 'Warnings & notices', ne: 'चेतावनी र सूचना', hi: 'चेतावनी और नोटिस' },
  notices_for_you: { ar: 'الإشعارات الموجهة لك', en: 'Notices for you', ne: 'तपाईंका लागि सूचना', hi: 'आपके लिए नोटिस' },
  nothing: { ar: 'ما فيه شي ✓', en: 'Nothing here ✓', ne: 'केही छैन ✓', hi: 'कुछ नहीं ✓' },
  read_sign: { ar: 'اقرأ ووقّع', en: 'Read & sign', ne: 'पढेर हस्ताक्षर', hi: 'पढ़ें और हस्ताक्षर करें' },
  n_warning: { ar: 'إنذار', en: 'Warning', ne: 'चेतावनी', hi: 'चेतावनी' },
  n_final_warning: { ar: 'إنذار نهائي', en: 'Final warning', ne: 'अन्तिम चेतावनी', hi: 'अंतिम चेतावनी' },
  n_deduction: { ar: 'خصم', en: 'Deduction', ne: 'कटौती', hi: 'कटौती' },
  n_other: { ar: 'إشعار', en: 'Notice', ne: 'सूचना', hi: 'नोटिस' },
  ns_pending: { ar: 'بانتظار التوقيع', en: 'Awaiting signature', ne: 'हस्ताक्षर बाँकी', hi: 'हस्ताक्षर लंबित' },
  ns_signed: { ar: 'تم التوقيع', en: 'Signed', ne: 'हस्ताक्षर भयो', hi: 'हस्ताक्षरित' },
  ns_refused: { ar: 'رفض التوقيع', en: 'Refused to sign', ne: 'हस्ताक्षर अस्वीकार', hi: 'हस्ताक्षर से इनकार' },
  issued_on: { ar: 'صادر بتاريخ {d}', en: 'Issued on {d}', ne: '{d} मा जारी', hi: '{d} को जारी' },
  deduct_from: { ar: 'خصم {a} د.ك من راتب شهر {m}', en: 'Deduction of {a} KWD from {m} salary', ne: '{m} को तलबबाट {a} KWD कटौती', hi: '{m} के वेतन से {a} KWD कटौती' },
  your_comment: { ar: 'تعليقك (اختياري)', en: 'Your comment (optional)', ne: 'तपाईंको टिप्पणी (ऐच्छिक)', hi: 'आपकी टिप्पणी (वैकल्पिक)' },
  sign_means: { ar: 'توقيعك يعني إنك استلمت الإشعار واطلعت عليه.', en: 'Signing means you received and read this notice.', ne: 'हस्ताक्षरको अर्थ तपाईंले यो सूचना पाउनुभयो र पढ्नुभयो।', hi: 'हस्ताक्षर का अर्थ है कि आपने यह नोटिस प्राप्त किया और पढ़ लिया।' },
  sign_receive: { ar: 'توقيع واستلام', en: 'Sign & acknowledge', ne: 'हस्ताक्षर र प्राप्ति', hi: 'हस्ताक्षर और प्राप्ति' },
  refuse_sign: { ar: 'رفض التوقيع', en: 'Refuse to sign', ne: 'हस्ताक्षर अस्वीकार', hi: 'हस्ताक्षर से इनकार' },
  sign_first: { ar: 'وقّع أول', en: 'Please sign first', ne: 'पहिले हस्ताक्षर गर्नुहोस्', hi: 'पहले हस्ताक्षर करें' },
  emp_comment: { ar: 'تعليقك', en: 'Your comment', ne: 'तपाईंको टिप्पणी', hi: 'आपकी टिप्पणी' },

  // payslips
  payslips_title: { ar: 'كشوف راتبي', en: 'My payslips', ne: 'मेरो तलब विवरण', hi: 'मेरी सैलरी स्लिप' },
  print: { ar: 'طباعة / PDF', en: 'Print / PDF', ne: 'प्रिन्ट / PDF', hi: 'प्रिंट / PDF' },
  no_payslips: { ar: 'ما فيه كشوف رواتب معتمدة للحين', en: 'No approved payslips yet', ne: 'अहिलेसम्म स्वीकृत तलब विवरण छैन', hi: 'अभी कोई स्वीकृत सैलरी स्लिप नहीं' },
  payslip: { ar: 'كشف راتب', en: 'Payslip', ne: 'तलब विवरण', hi: 'सैलरी स्लिप' },
  approved_ps: { ar: 'معتمد', en: 'Approved', ne: 'स्वीकृत', hi: 'स्वीकृत' },
  draft: { ar: 'مسودة', en: 'Draft', ne: 'मस्यौदा', hi: 'ड्राफ्ट' },
  employee: { ar: 'الموظف', en: 'Employee', ne: 'कर्मचारी', hi: 'कर्मचारी' },
  job: { ar: 'الوظيفة', en: 'Job', ne: 'पद', hi: 'पद' },
  approved_on: { ar: 'تاريخ الاعتماد', en: 'Approved on', ne: 'स्वीकृत मिति', hi: 'स्वीकृति तिथि' },
  earnings: { ar: 'المستحقات', en: 'Earnings', ne: 'आम्दानी', hi: 'कमाई' },
  deductions: { ar: 'الخصومات', en: 'Deductions', ne: 'कटौती', hi: 'कटौतियाँ' },
  total: { ar: 'المجموع', en: 'Total', ne: 'जम्मा', hi: 'कुल' },
  no_deductions: { ar: 'ما فيه خصومات', en: 'No deductions', ne: 'कुनै कटौती छैन', hi: 'कोई कटौती नहीं' },
  net_salary: { ar: 'صافي الراتب', en: 'Net salary', ne: 'खुद तलब', hi: 'शुद्ध वेतन' },
  basic_salary: { ar: 'الراتب الأساسي', en: 'Basic salary', ne: 'आधारभूत तलब', hi: 'मूल वेतन' },
  overtime: { ar: 'الإضافي', en: 'Overtime', ne: 'ओभरटाइम', hi: 'ओवरटाइम' },
  late_ded: { ar: 'تأخير ({n} دقيقة)', en: 'Late ({n} min)', ne: 'ढिलाइ ({n} मिनेट)', hi: 'देरी ({n} मिनट)' },
  absence_ded: { ar: 'غياب ({n} يوم)', en: 'Absence ({n} days)', ne: 'अनुपस्थिति ({n} दिन)', hi: 'अनुपस्थिति ({n} दिन)' },
  unpaid_ded: { ar: 'إجازة بدون راتب ({n} يوم)', en: 'Unpaid leave ({n} days)', ne: 'बिना तलब बिदा ({n} दिन)', hi: 'अवैतनिक छुट्टी ({n} दिन)' },
  kwd: { ar: 'د.ك', en: 'KWD', ne: 'KWD', hi: 'KWD' },

  // notifications
  notif_title: { ar: 'التنبيهات', en: 'Notifications', ne: 'सूचनाहरू', hi: 'सूचनाएँ' },
  mark_all: { ar: 'تعليم الكل كمقروء', en: 'Mark all as read', ne: 'सबै पढिएको चिन्ह लगाउनुहोस्', hi: 'सभी को पढ़ा हुआ करें' },
  no_notifs: { ar: 'ما فيه تنبيهات', en: 'No notifications', ne: 'कुनै सूचना छैन', hi: 'कोई सूचना नहीं' },
  nk_doc_expiring: { ar: 'مستندك قرب ينتهي', en: 'Your document expires soon', ne: 'तपाईंको कागजात छिट्टै समाप्त हुँदैछ', hi: 'आपका दस्तावेज़ जल्द समाप्त होगा' },
  nk_doc_expiring_b: { ar: '{doc} تنتهي بعد {days} يوم ({date})', en: '{doc} expires in {days} days ({date})', ne: '{doc} {days} दिनमा समाप्त हुन्छ ({date})', hi: '{doc} {days} दिन में समाप्त होगा ({date})' },
  nk_doc_expired: { ar: 'مستندك منتهي', en: 'Your document has expired', ne: 'तपाईंको कागजात समाप्त भयो', hi: 'आपका दस्तावेज़ समाप्त हो गया' },
  nk_doc_approved: { ar: 'تم اعتماد مستندك', en: 'Your document was approved', ne: 'तपाईंको कागजात स्वीकृत भयो', hi: 'आपका दस्तावेज़ स्वीकृत हुआ' },
  nk_doc_rejected: { ar: 'مستندك مرفوض، ارفعه من جديد', en: 'Your document was rejected, please upload it again', ne: 'तपाईंको कागजात अस्वीकृत भयो, फेरि अपलोड गर्नुहोस्', hi: 'आपका दस्तावेज़ अस्वीकृत हुआ, कृपया फिर से अपलोड करें' },
  nk_doc_review_b: { ar: '{doc}', en: '{doc}', ne: '{doc}', hi: '{doc}' },
  nk_doc_expired_b: { ar: '{doc} انتهت بتاريخ {date}', en: '{doc} expired on {date}', ne: '{doc} {date} मा समाप्त भयो', hi: '{doc} {date} को समाप्त हुआ' },
  nk_missed_no_punch: { ar: 'نسيت تبصم؟', en: 'Did you forget to punch?', ne: 'हाजिरी गर्न बिर्सनुभयो?', hi: 'क्या आप हाज़िरी लगाना भूल गए?' },
  nk_missed_no_punch_b: { ar: 'ما فيه بصمة حضور بتاريخ {date}. أرسل طلب نسيان بصمة.', en: 'No check-in on {date}. Please send a missed punch request.', ne: '{date} मा आगमन हाजिरी छैन। छुटेको हाजिरी अनुरोध पठाउनुहोस्।', hi: '{date} को कोई चेक इन नहीं। छूटी हाज़िरी अनुरोध भेजें।' },
  nk_missed_no_checkout: { ar: 'نسيت تبصم انصراف؟', en: 'Did you forget to check out?', ne: 'प्रस्थान गर्न बिर्सनुभयो?', hi: 'क्या आप चेक आउट भूल गए?' },
  nk_missed_no_checkout_b: { ar: 'ما فيه بصمة انصراف بتاريخ {date}. أرسل طلب نسيان بصمة.', en: 'No check-out on {date}. Please send a missed punch request.', ne: '{date} मा प्रस्थान हाजिरी छैन। छुटेको हाजिरी अनुरोध पठाउनुहोस्।', hi: '{date} को कोई चेक आउट नहीं। छूटी हाज़िरी अनुरोध भेजें।' },
  nk_leave_approved: { ar: 'تمت الموافقة على إجازتك', en: 'Your leave was approved', ne: 'तपाईंको बिदा स्वीकृत भयो', hi: 'आपकी छुट्टी स्वीकृत हुई' },
  nk_leave_rejected: { ar: 'تم رفض طلب إجازتك', en: 'Your leave was rejected', ne: 'तपाईंको बिदा अस्वीकृत भयो', hi: 'आपकी छुट्टी अस्वीकृत हुई' },
  nk_leave_b: { ar: 'إجازة {type} من {from} إلى {to}', en: '{type} leave from {from} to {to}', ne: '{from} देखि {to} सम्म {type} बिदा', hi: '{from} से {to} तक {type} छुट्टी' },
  nk_notice_issued: { ar: 'وصلك إشعار من الإدارة', en: 'You received a notice from management', ne: 'व्यवस्थापनबाट सूचना आयो', hi: 'प्रबंधन से नोटिस मिला' },
  nk_notice_issued_b: { ar: '{title} — مطلوب توقيعك', en: '{title} — your signature is required', ne: '{title} — तपाईंको हस्ताक्षर चाहिन्छ', hi: '{title} — आपका हस्ताक्षर आवश्यक है' },
  nk_payslip_ready: { ar: 'كشف راتبك جاهز', en: 'Your payslip is ready', ne: 'तपाईंको तलब विवरण तयार छ', hi: 'आपकी सैलरी स्लिप तैयार है' },
  nk_payslip_ready_b: { ar: 'كشف راتب {month}', en: 'Payslip for {month}', ne: '{month} को तलब विवरण', hi: '{month} की सैलरी स्लिप' },
  nk_correction_approved: { ar: 'تم قبول طلب نسيان البصمة', en: 'Your missed punch request was approved', ne: 'छुटेको हाजिरी अनुरोध स्वीकृत भयो', hi: 'छूटी हाज़िरी अनुरोध स्वीकृत हुआ' },
  nk_correction_rejected: { ar: 'تم رفض طلب نسيان البصمة', en: 'Your missed punch request was rejected', ne: 'छुटेको हाजिरी अनुरोध अस्वीकृत भयो', hi: 'छूटी हाज़िरी अनुरोध अस्वीकृत हुआ' },
}

// names stored in Arabic in the database
const NAMES = {
  'سنوية': { en: 'Annual', ne: 'वार्षिक', hi: 'वार्षिक' },
  'مرضية': { en: 'Sick', ne: 'बिरामी', hi: 'बीमारी' },
  'طارئة': { en: 'Emergency', ne: 'आपतकालीन', hi: 'आपातकालीन' },
  'بدون راتب': { en: 'Unpaid', ne: 'बिना तलब', hi: 'अवैतनिक' },
  'أوف': { en: 'Day off', ne: 'छुट्टी', hi: 'ऑफ़' },
  'البطاقة المدنية': { en: 'Civil ID', ne: 'सिभिल आईडी', hi: 'सिविल आईडी' },
  'رخصة القيادة': { en: 'Driving licence', ne: 'सवारी चालक अनुमतिपत्र', hi: 'ड्राइविंग लाइसेंस' },
  'كرت الصحة': { en: 'Health card', ne: 'स्वास्थ्य कार्ड', hi: 'हेल्थ कार्ड' },
  'جواز السفر': { en: 'Passport', ne: 'राहदानी', hi: 'पासपोर्ट' },
  'الإقامة': { en: 'Residency', ne: 'आवासीय अनुमति', hi: 'रेज़िडेंसी' },
  'بدل': { en: 'Allowance', ne: 'भत्ता', hi: 'भत्ता' },
  'بدل سكن': { en: 'Housing allowance', ne: 'आवास भत्ता', hi: 'आवास भत्ता' },
  'بدل مواصلات': { en: 'Transport allowance', ne: 'यातायात भत्ता', hi: 'परिवहन भत्ता' },
  'بدل عدوى': { en: 'Hazard allowance', ne: 'जोखिम भत्ता', hi: 'जोखिम भत्ता' },
  'بدل طعام': { en: 'Food allowance', ne: 'खाना भत्ता', hi: 'भोजन भत्ता' },
  'بدل هاتف': { en: 'Phone allowance', ne: 'फोन भत्ता', hi: 'फ़ोन भत्ता' },
  'مكافأة': { en: 'Bonus', ne: 'बोनस', hi: 'बोनस' },
  'خصم': { en: 'Deduction', ne: 'कटौती', hi: 'कटौती' },
  'شيف': { en: 'Chef', ne: 'सेफ', hi: 'शेफ़' },
  'مساعد شيف': { en: 'Assistant chef', ne: 'सहायक सेफ', hi: 'सहायक शेफ़' },
  'شيف سلطة': { en: 'Salad chef', ne: 'सलाद सेफ', hi: 'सलाद शेफ़' },
  'كاشير': { en: 'Cashier', ne: 'क्यासियर', hi: 'कैशियर' },
  'سايق': { en: 'Driver', ne: 'चालक', hi: 'ड्राइवर' },
  'تغليف': { en: 'Packing', ne: 'प्याकिङ', hi: 'पैकिंग' },
  'كول سنتر': { en: 'Call centre', ne: 'कल सेन्टर', hi: 'कॉल सेंटर' },
  'إدخال بيانات': { en: 'Data entry', ne: 'डाटा इन्ट्री', hi: 'डेटा एंट्री' },
  'موظف': { en: 'Employee', ne: 'कर्मचारी', hi: 'कर्मचारी' },
  'المطبخ المركزي': { en: 'Central kitchen', ne: 'केन्द्रीय भान्सा', hi: 'केंद्रीय रसोई' },
  'الإدارة الرئيسية': { en: 'Head office', ne: 'मुख्य कार्यालय', hi: 'मुख्य कार्यालय' },
  'صباح السالم': { en: 'Sabah Al-Salem', ne: 'सबाह अल-सालेम', hi: 'सबाह अल-सालेम' },
  'المهبولة': { en: 'Mahboula', ne: 'महबूला', hi: 'महबूला' },
  'الجابرية': { en: 'Jabriya', ne: 'जाब्रिया', hi: 'जाब्रिया' },
  'الجهراء': { en: 'Jahra', ne: 'जहरा', hi: 'जहरा' },
}

const LangCtx = createContext(null)
const stored = () => { try { return localStorage.getItem('lang') } catch { return null } }

export function LangProvider({ employee, children }) {
  const [lang, setLangState] = useState(employee?.language || stored() || 'ar')
  useEffect(() => { if (employee?.language) setLangState(employee.language) }, [employee?.language])
  const info = LANGS.find((l) => l.code === lang) || LANGS[0]
  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = info.dir
  }, [lang, info.dir])

  const setLang = useCallback(async (code) => {
    setLangState(code)
    try { localStorage.setItem('lang', code) } catch { /* ignore */ }
    if (employee) await supabase.rpc('set_my_language', { p_lang: code })
  }, [employee])

  const t = useCallback((key, p = {}) => {
    const s = D[key]?.[lang] ?? D[key]?.ar ?? key
    return s.replace(/\{(\w+)\}/g, (_, k) => (p[k] ?? ''))
  }, [lang])
  // translate an Arabic phrase used directly in a page (see phrases.js)
  const tr = useCallback((ar, p = {}) => {
    const s = lang === 'ar' ? ar : PHRASES[ar]?.[lang] ?? ar
    return String(s).replace(/\{(\w+)\}/g, (_, k) => (p[k] ?? ''))
  }, [lang])
  const tn = useCallback((name) => (name && lang !== 'ar' ? NAMES[name]?.[lang] ?? name : name), [lang])
  const fmtDate = useCallback((d) => d ? new Intl.DateTimeFormat(info.locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kuwait', numberingSystem: 'latn' }).format(new Date(d)) : '—', [info.locale])
  const fmtTime = useCallback((d) => d ? new Intl.DateTimeFormat(info.locale, { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuwait', numberingSystem: 'latn' }).format(new Date(d)) : '—', [info.locale])

  return <LangCtx.Provider value={{ lang, dir: info.dir, setLang, t, tr, tn, fmtDate, fmtTime }}>{children}</LangCtx.Provider>
}

export const useLang = () => useContext(LangCtx)

export function LangPicker({ compact }) {
  const { lang, setLang, t } = useLang()
  return (
    <label className="row" style={{ gap: 8, fontSize: 14 }}>
      {!compact && <span className="sub">{t('language')}</span>}
      <select className="input" style={{ height: 40, width: 'auto', minWidth: 120 }} value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language">
        {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
      </select>
    </label>
  )
}

// Admin screens always use Arabic, whatever the user's language
const arT = (key, p = {}) => (D[key]?.ar ?? key).replace(/\{(\w+)\}/g, (_, k) => (p[k] ?? ''))
const arDate = (d) => d ? new Intl.DateTimeFormat('ar-KW', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kuwait', numberingSystem: 'latn' }).format(new Date(d)) : '—'
const arTime = (d) => d ? new Intl.DateTimeFormat('ar-KW', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuwait', numberingSystem: 'latn' }).format(new Date(d)) : '—'
export function useT(forceAr) {
  const c = useLang()
  if (!forceAr) return c
  return { ...c, lang: 'ar', dir: 'rtl', t: arT, tr: (a, p = {}) => String(a).replace(/\{(\w+)\}/g, (_, k) => (p[k] ?? '')), tn: (n) => n, fmtDate: arDate, fmtTime: arTime }
}
