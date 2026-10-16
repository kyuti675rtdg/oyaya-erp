# የኦያያ ዱቄት ፋብሪካ ERP — ከደንበኛ የሚያስፈልጉ መረጃዎች

**Oyaya Flour Factory ERP — Client Inputs Required**
*የተዘጋጀው በ፦ Orbit Technology Solution PLC · 2026-10-16*

---

## መግቢያ / Introduction

የኦያያ ዱቄት ፋብሪካ ERP ሥርዓት ግንባታው ተጠናቋል፤ ሁሉም 17 ሞዱሎች ተገንብተው ተፈትነዋል።
ሥርዓቱን ሙሉ በሙሉ ወደ ሥራ ለማስገባት (SMS ማንቂያዎች፣ የጣት አሻራ መገኘት፣ ትክክለኛ የደመወዝ ስሌት) ከኦያያ የሚከተሉት መረጃዎች ያስፈልጋሉ።

The Oyaya Flour Factory ERP build is complete and all 17 modules are built and tested. To put the system into full production operation (SMS alerts, biometric attendance, exact payroll calculation), Oyaya needs to provide the following.

---

## 1. የSMS አገልግሎት (AfroMessage) / SMS Service

| # | የሚያስፈልገው / Required | ምላሽ / Response |
|---|---|---|
| 1.1 | የአፍሮሜሴጅ API ቁልፍ (token) አለዎት? / Do you have an AfroMessage API token? | ☐ አለን / Yes ☐ የለንም / No |
| 1.2 | ከሌለዎት፣ Orbit እንዲያዘጋጅልዎት ይፈልጋሉ? / If not, should Orbit procure and set it up? | ☐ አዎ / Yes ☐ አይ / No |
| 1.3 | SMS ማንቂያ የሚደርሳቸው ሠራተኞች ስልክ ቁጥሮች / Phone numbers for SMS alert recipients | |
| | — የጥራት ሥራ አስኪያጅ (Quality Head)፦ ________________ | |
| | — የምርት ሥራ አስኪያጅ (Production Manager)፦ ________________ | |
| | — ባለቤት / ዋና ሥራ አስፈጻሚ (Owner/CEO)፦ ________________ | |
| | — የንጽህና ተቆጣጣሪ (Pest Inspector)፦ ________________ | |

---

## 2. የጣት አሻራ መሣሪያዎች (ZKTeco) / Biometric Terminals

| # | የሚያስፈልገው / Required | ምላሽ / Response |
|---|---|---|
| 2.1 | የZKTeco መሣሪያዎች አሉ? / Do ZKTeco terminals exist at the factory? | ☐ አሉ / Yes ☐ የሉም / No |
| 2.2 | ሞዴል (ለምሳሌ SpeedFace-V5L፣ uFace800) / Model(s) | ________________ |
| 2.3 | በተቀመጡበት ቦታ — በር እና የወፍጮ መግቢያ / Installed at gate and milling-floor entrance? | ☐ አዎ / Yes ☐ አይ / No |
| 2.4 | ከፋብሪካው LAN ጋር ተገናኝተዋል? (PoE / ኔትወርክ) / Connected to the factory LAN? | ☐ አዎ / Yes ☐ አይ / No |
| 2.5 | ከሌሉ፣ Orbit እንዲመክር/ያዘጋጅ ይፈልጋሉ? / If not yet purchased, should Orbit advise on procurement? | ☐ አዎ / Yes ☐ አይ / No |

---

## 3. የሠራተኞች ክፍያ ተመኖች / Payroll Rates (Birr)

የሥራ ደረጃ ክፍያ (Birr በኩንታል) — ለአራት የሥራ ደረጃዎች፦
Stage piece rates (Birr per quintal) — for the four labor stages:

| የሥራ ደረጃ / Labor stage | ተመን (Birr/ኩንታል) / Rate (Birr/quintal) |
|---|---|
| ከመኪና ማውረድ / Unloading from truck | __________ |
| ወደ ጎተራ ማፍሰስ / Dumping into granary | __________ |
| የተዘጋጀ ምርት ወደ መጋዘን ማንቀሳቀስ / Moving sorted output to store | __________ |
| የተጠናቀቀ ምርት በመኪና ላይ መጫን / Loading finished goods onto delivery trucks | __________ |

የአሽከርካሪ የጉዞ ክፍያ (Birr በጉዞ) / Driver trip rates (Birr per trip):

| መግለጫ / Description | ተመን / Rate |
|---|---|
| የአሽከርካሪ ክፍያ በአንድ ጉዞ (የአካባቢ ጉዞ ሕግ መሠረት) / Driver pay per completed trip (fixed destination-area trip rule) | __________ Birr/ጉዞ |

---

## 4. የዕለታዊ የምርት ሪፖርት መስኮች / Daily Production Report Fields

| # | ጥያቄ / Question | ምላሽ / Response |
|---|---|---|
| 4.1 | «Reject/Waste» እና «Gluten» በዕለታዊ ሪፖርቱ ላይ የተለዩ መስኮች ሊሆኑ ይገባል? / Should "Reject/Waste" and "Gluten" be separate fields on the Daily Production Report? | ☐ አዎ፣ የተለዩ / Yes, separate ☐ አይ፣ አያስፈልግም / No |
| 4.2 | ሌላ የሚጨመር መስክ ካለ / Any other fields to add? | ________________ |

---

## 5. የመለዋወጫ ዕቃዎች ምርመራ / Spare Parts Verification (Module 9)

| # | ጥያቄ / Question | ምላሽ / Response |
|---|---|---|
| 5.1 | የመለዋወጫ ዕቃዎች ምርመራ ምን ዓይነት ነው? / What type of spare-parts check? | ☐ የክምችት መጠን ብቻ / Stock level only ☐ የአካላዊ ሁኔታ ብቻ / Physical condition only ☐ ሁለቱም / Both |

---

## 6. የማሽን ጥገና ዝርዝር / Machine Maintenance Checklist (Module 9)

የፋብሪካው የመጨረሻ የማሽን ጥገና ዝርዝር (የማሽኖች ስም እና የጥገና ሥራዎች) ከዚህ ጋር ያያይዙ፦
Please attach the factory's final machine maintenance checklist (machine names and maintenance tasks):

☐ ተያይዟል / Attached ☐ በኋላ ይላካል / Will be sent later

---

## 7. ዶሜይን / Domain

| # | ጥያቄ / Question | ምላሽ / Response |
|---|---|---|
| 7.1 | የሥርዓቱ ዶሜይን `erp.oyayaflour.com` ሆኖ ይቀጥል? / Confirm the system domain `erp.oyayaflour.com` (used for the system URL and SMS delivery callbacks)? | ☐ አዎ / Confirmed ☐ ሌላ፦ / Alternative: ________________ |

---

## 8. የመጀመሪያ ተጠቃሚ መለያዎች / Initial User Accounts

ለእያንዳንዱ ሚና ስም፣ ስልክ እና ኢሜይል ይሙሉ፦ / Provide name, phone and email per role:

| ሚና / Role | ሙሉ ስም / Full name | ስልክ / Phone | ኢሜይል / Email |
|---|---|---|---|
| ባለቤት / CEO | | | |
| የጥራት ሥራ አስኪያጅ / Quality Head | | | |
| የምርት ሥራ አስኪያጅ / Production Manager | | | |
| የፋይናንስ ኦፊሰር / Finance Officer | | | |
| የሽያጭ ኦፊሰር / Sales Officer | | | |
| መጋዘን ጠባቂ / Storekeeper | | | |
| ሌላ / Other: ______ | | | |

---

## ማጠቃለያ / Next Steps

መረጃዎቹ እንደደረሱ፦
1. የSMS ማንቂያዎች እና የጣት አሻራ ግንኙነት ይዋቀራሉ፤
2. የክፍያ ተመኖች ወደ ሥርዓቱ ይገባሉ፤
3. የተጠቃሚ መለያዎች ይፈጠራሉ እና ሥልጠና ይጀመራል።

Once received: (1) SMS alerts and biometric connections will be configured; (2) payroll rates will be entered; (3) user accounts will be created and training begins.

**ያዘጋጀው፦ Orbit Technology Solution PLC**
📧 ceo@orbit.et · 📞 0963626061 / 0978345615 · 🌐 www.orbit.et
