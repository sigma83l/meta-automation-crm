/**
 * The questions a small business is actually asked, as a starting library.
 *
 * The assistant may only answer from approved knowledge, so a workspace with no
 * FAQs hands every conversation to a person however well the model performs.
 * The gap is rarely unwillingness: an owner opening an empty knowledge base
 * does not know what to write, and the blank box gives no clue. Live workspaces
 * bear that out - one reached production with a single item whose question was
 * "ww" and whose answer was "w".
 *
 * This is therefore a list of questions and not a list of answers. Only the
 * business knows its own prices, address and policies, and an answer supplied
 * here would either be wrong or, worse, plausible enough to publish unread.
 * What each entry carries instead is `guidance`: the one thing about a good
 * answer to that question which an owner would otherwise learn from a customer
 * complaint.
 *
 * ## Why several of the hints are about wording
 *
 * `validateReply` refuses a draft stating a time or an amount that no approved
 * text contains, and it compares tokens rather than meaning. So an answer of
 * "closed at weekends" approves neither "Saturday" nor "Sunday", and the
 * assistant is then forbidden from naming either day - it will hand off a
 * question this FAQ was written to answer. Spelling the days out is not
 * pedantry; it is the difference between an answer that can be given and one
 * that cannot. See `approvedTimeTokens`.
 */

export const FAQ_TEMPLATE_CATEGORIES = [
  "identity",
  "visiting",
  "buying",
  "service",
  "policy"
] as const;

export type FaqTemplateCategory = (typeof FAQ_TEMPLATE_CATEGORIES)[number];

export type FaqTemplate = Readonly<{
  id: string;
  category: FaqTemplateCategory;
  /** The question, in each language the app answers customers in. */
  question: Readonly<Record<"en" | "tr" | "fa", string>>;
  /** What a good answer has to contain, in the owner's own language. */
  guidance: Readonly<Record<"en" | "tr" | "fa", string>>;
}>;

export const FAQ_TEMPLATES: readonly FaqTemplate[] = Object.freeze([
  {
    id: "who_we_are",
    category: "identity",
    question: {
      en: "Who are you and what do you do?",
      tr: "Kimsiniz ve ne yapıyorsunuz?",
      fa: "شما چه کسی هستید و چه کاری انجام می‌دهید؟"
    },
    guidance: {
      en: "Name the business and say what it sells in one sentence. Without this the assistant cannot introduce you at all.",
      tr: "İşletmenin adını yazın ve ne sattığını tek cümleyle anlatın. Bu olmadan asistan sizi hiç tanıtamaz.",
      fa: "نام کسب‌وکار و آنچه می‌فروشید را در یک جمله بنویسید. بدون این، دستیار نمی‌تواند شما را معرفی کند."
    }
  },
  {
    id: "where_we_are",
    category: "visiting",
    question: {
      en: "Where are you located?",
      tr: "Adresiniz neresi?",
      fa: "آدرس شما کجاست؟"
    },
    guidance: {
      en: "Write the address as you would say it aloud, plus one landmark. The assistant will not guess an address it has not been given.",
      tr: "Adresi söyler gibi yazın ve bir yol tarifi ekleyin. Asistan kendisine verilmemiş bir adresi tahmin etmez.",
      fa: "آدرس را همان‌طور که می‌گویید بنویسید و یک نشانه اضافه کنید. دستیار آدرسی را که به او داده نشده حدس نمی‌زند."
    }
  },
  {
    id: "opening_hours",
    category: "visiting",
    question: {
      en: "What are your opening hours?",
      tr: "Çalışma saatleriniz nedir?",
      fa: "ساعات کاری شما چیست؟"
    },
    guidance: {
      en: 'Name every day you mean, including the closed ones. "Closed at weekends" does not let the assistant say "Saturday".',
      tr: 'Kapalı günler dahil her günü tek tek yazın. "Hafta sonu kapalı" ifadesi asistanın "Cumartesi" demesine izin vermez.',
      fa: "هر روز را نام ببرید، از جمله روزهای تعطیل. عبارت «آخر هفته تعطیل» به دستیار اجازه نمی‌دهد «شنبه» بگوید."
    }
  },
  {
    id: "parking_access",
    category: "visiting",
    question: {
      en: "Is there parking, and is the entrance step-free?",
      tr: "Otopark var mı ve giriş engelsiz mi?",
      fa: "پارکینگ دارید و ورودی بدون پله است؟"
    },
    guidance: {
      en: "Answer both parts. A customer who cannot get in is the one most likely to ask first.",
      tr: "İki soruyu da yanıtlayın. İçeri giremeyecek müşteri, ilk soran kişidir.",
      fa: "به هر دو بخش پاسخ دهید. مشتری‌ای که نمی‌تواند وارد شود، معمولاً اولین پرسنده است."
    }
  },
  {
    id: "prices",
    category: "buying",
    question: {
      en: "How much does it cost?",
      tr: "Fiyatı ne kadar?",
      fa: "قیمت آن چقدر است؟"
    },
    guidance: {
      en: "Add real figures under Prices rather than here, and use this to explain what is included. An amount in a FAQ the price list does not confirm will be refused.",
      tr: "Gerçek rakamları burada değil Fiyatlar bölümüne ekleyin; burada neyin dahil olduğunu anlatın. Fiyat listesinin doğrulamadığı bir tutar reddedilir.",
      fa: "ارقام واقعی را در بخش قیمت‌ها بیفزایید و اینجا توضیح دهید چه چیزی شامل می‌شود. مبلغی که فهرست قیمت تأیید نکند رد می‌شود."
    }
  },
  {
    id: "payment_methods",
    category: "buying",
    question: {
      en: "What payment methods do you accept?",
      tr: "Hangi ödeme yöntemlerini kabul ediyorsunuz?",
      fa: "چه روش‌های پرداختی را می‌پذیرید؟"
    },
    guidance: {
      en: "List what you take and, just as usefully, what you do not.",
      tr: "Kabul ettiklerinizi ve en az onun kadar yararlı olarak kabul etmediklerinizi yazın.",
      fa: "آنچه می‌پذیرید و به همان اندازه مهم، آنچه نمی‌پذیرید را بنویسید."
    }
  },
  {
    id: "booking",
    category: "service",
    question: {
      en: "How do I book an appointment?",
      tr: "Nasıl randevu alabilirim?",
      fa: "چگونه می‌توانم نوبت بگیرم؟"
    },
    guidance: {
      en: "Say what you need from them to book. The assistant cannot make the booking itself, so this has to tell them the next step.",
      tr: "Randevu için onlardan neye ihtiyacınız olduğunu yazın. Asistan randevuyu kendisi oluşturamaz; bu yüzden burada sonraki adım anlatılmalı.",
      fa: "بگویید برای رزرو چه چیزی از آن‌ها لازم دارید. دستیار خودش رزرو نمی‌کند، پس اینجا باید گام بعدی را بگویید."
    }
  },
  {
    id: "delivery",
    category: "service",
    question: {
      en: "Do you deliver, and how long does it take?",
      tr: "Teslimat yapıyor musunuz ve ne kadar sürüyor?",
      fa: "ارسال دارید و چقدر طول می‌کشد؟"
    },
    guidance: {
      en: "Give the area you cover and a timescale you can stand behind. The assistant will repeat it exactly.",
      tr: "Hizmet verdiğiniz bölgeyi ve arkasında durabileceğiniz bir süreyi yazın. Asistan bunu aynen tekrarlar.",
      fa: "محدوده خدمات و بازه زمانی‌ای که پایش می‌ایستید را بنویسید. دستیار دقیقاً همان را تکرار می‌کند."
    }
  },
  {
    id: "returns",
    category: "policy",
    question: {
      en: "What is your returns or cancellation policy?",
      tr: "İade veya iptal politikanız nedir?",
      fa: "سیاست بازگشت یا لغو شما چیست؟"
    },
    guidance: {
      en: "State the window in days and what condition the item must be in. This is the answer customers quote back to you.",
      tr: "Süreyi gün olarak ve ürünün hangi durumda olması gerektiğini yazın. Müşterilerin size karşı alıntıladığı yanıt budur.",
      fa: "بازه را به روز و شرط لازم کالا را بنویسید. این همان پاسخی است که مشتری بعداً به شما یادآوری می‌کند."
    }
  },
  {
    id: "speak_to_person",
    category: "policy",
    question: {
      en: "Can I speak to a person?",
      tr: "Bir kişiyle görüşebilir miyim?",
      fa: "می‌توانم با یک نفر صحبت کنم؟"
    },
    guidance: {
      en: "Say when somebody is available and how to reach them. Anyone asking this has already decided the assistant is not enough.",
      tr: "Birinin ne zaman müsait olduğunu ve nasıl ulaşılacağını yazın. Bunu soran kişi asistanın yetmediğine çoktan karar vermiştir.",
      fa: "بگویید چه زمانی کسی در دسترس است و چگونه با او تماس بگیرند. هرکس این را بپرسد، قبلاً تصمیم گرفته دستیار کافی نیست."
    }
  }
]);

/** The templates a workspace has not written an answer for yet. */
export function missingTemplates(
  existingQuestions: readonly string[],
  locale: "en" | "tr" | "fa"
): readonly FaqTemplate[] {
  // Compared case- and space-insensitively, and against every language: an
  // owner who answered this in Turkish and then switched the workspace to
  // English has answered it, and offering it again would invite a duplicate
  // that can disagree with the first.
  const normalise = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  const answered = new Set(existingQuestions.map(normalise));
  return FAQ_TEMPLATES.filter(
    (template) =>
      !Object.values(template.question).some((phrasing) => answered.has(normalise(phrasing))) &&
      template.question[locale].length > 0
  );
}
