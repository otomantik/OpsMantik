# Projection Reducer Specification (PROJECTION_REDUCER_SPEC)

**Deterministik projection rebuild — tek sıra zorunlu**

Aynı input ledger için projection rebuild her zaman aynı sonucu üretmelidir. Bu yüzden order kuralı belirsiz kalmamalı.

---

## Reducer Order (Kesin)

| Sıra | Alan | Yön |
| ---- | ---- | --- |
| 1 | occurred_at | ASC NULLS LAST |
| 2 | ingested_at | ASC |
| 3 | created_at | ASC |
| 4 | id | ASC |

```sql
ORDER BY occurred_at ASC NULLS LAST, ingested_at ASC, created_at ASC, id ASC
```

---

## Kontrat (Zorunlu)

- **Determinism:** Aynı input ledger → aynı projection sonucu.
- **Latest-write yarışı yok:** Order sabit; yarış yok.
- **Projection = deterministic reducer:** Gerekirse tam rebuild edilebilir.
- **Incremental best-effort değil:** Reducer her zaman idempotent ve tutarlı.
- **Order dışına çıkılamaz:** Bu ORDER BY değiştirilemez.
