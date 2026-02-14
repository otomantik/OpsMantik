# PR #17 ayırma — yapılacaklar (tek seferlik)

## Db push gerekir mi?

- **release/revenue-kernel-pr1-4 → master merge:** **Hayır.** Bu branch’te sadece 20260216* migration’ları var, prod’da zaten uygulanmış. Ek db push yok.
- **Future pack (chore/revenue-kernel-future-pack) merge (ileride):** **Evet.** Önce 20260217000000 ve 20260217000001 prod’da uygulanacak (`supabase db push` veya migration run), sonra merge.

---

## 1) PR #17’yi kapat (merge etmeden)

1. Tarayıcıda aç:  
   `https://github.com/otomantik/OpsMantik/pull/17`
2. Sayfanın altında **"Close pull request"** tıkla (merge değil).
3. İstersen önce şu yorumu ekle (runbook §4.2’deki blok).

---

## 2) Release PR’ını aç (bunu merge et)

1. Yeni PR sayfası:  
   `https://github.com/otomantik/OpsMantik/compare/master...release/revenue-kernel-pr1-4`
2. Base: **master**, compare: **release/revenue-kernel-pr1-4** (URL’de zaten böyle).
3. Title örn: `Release: Revenue Kernel PR-1..PR-4 + fail-secure + runbook`
4. **Create pull request** → Review sonrası **Merge**.

---

## 3) Future pack

Branch `chore/revenue-kernel-future-pack` olduğu gibi kalsın. İleride:

- Önce prod’da: `supabase db push` (veya 20260217* migration’ları çalıştır).
- Sonra bu branch için ayrı PR aç, smoke sonrası merge.

---

## GitHub CLI ile (isteğe bağlı)

`gh` kurulu olsaydı:

```bash
gh pr close 17 --comment "Merge blocked. Bu PR release ile future pack karışık. release/revenue-kernel-pr1-4 -> master ayrı PR'dan merge edilecek."
gh pr create --base master --head release/revenue-kernel-pr1-4 --title "Release: Revenue Kernel PR-1..PR-4 + fail-secure + runbook" --body "Sadece release paketi. Future pack ayrı PR."
```

Kurulum: https://cli.github.com/
