# Albums out for listening

Blind albums the brain has sent Mikey and not yet heard back on. Each
key is derivable from the album code itself (decode it with
`share.js decodeAlbum` and read the specs), so no key is written here.

## "Moods" (2026-09-28, on v64 or later) -- retired 2026-09-28

Retired before it was heard: the word-ranking test (queue item 19) asks
the same things faster. Kept for the record.

Eight short loops (8 bars or fewer), each led at 80%+ by one mood: two
joyful, two happy, two peaceful, two reflective, shuffled. Key: each
spec's leading `feelMix` entry. Changed 2026-09-28: describing each
track freely felt too abstract, so the test is now **most and least**.
Listen to all eight, then for each word give two track numbers, the
track that is most like it and the one least like it ("none" is fine):
happy, lively, warm, crisp, floating, bouncy, twinkling, intimate,
quirky. Uses: whether the mood steering (item 16) makes happy sound happy,
and Mikey's picks become the first data for the word regions (roadmap 19,
maps and clouds in `docs/MOODS.md`).

```
DLA1-0C2MT-VVFCH-SG020-02C10-J20G0-ECPSD-9MNPG-25BGA-951P0-VENZ6-KD2SK-9S4SR-78CEJ-W0GSZ-R10ZZ-NJE3N-B7Y2P-00000-00002-S040G-G402K-A6YZ8-1VMAF-B7BQ9-E817G-977C9-ZF7NZ-SDD7P-BJRJ0-84TJ3-AP080-J41EX-KJ1SY-S5P9W-00008-00002-00200-0R000-00000-1W288-0C602-V0AE3-NXZ7J-AFNBR-WF688-JGD7N-3V27D-J5GRA-4ZKZY-10D3W-03C0N-60R1G-60780-W5GC3-6SCE5-3SFGB-00000-00001-10M48-41G5B-46C22-HMSPV-AVZVJ-AHAFR-HNEKG-D1RXW-CMSSJ-GTJS0-42P00-RZG40-1307E-DB365-QA4JT-00000-00000-Y1850-8410H-FD9AJ-M6VAF-47D91-R8MJP-CEJ0Z-TWZP3-SZA0V-3CG30-83QA0-4A080-1T1Z2-BS3QT-M3P70-00000-00001-W2G80-G803F-3RV5K-KNN4F-JGG6F-DWJDN-NWY1B-V4XYB-72RFC-MTMT0-G2TW0-2G0G7-140ZD-K2VG8-QWY8R-00000-00006-C0G41-0G86C-EXCWX-DM8QZ-P6RP6-C5210-FQ4G9-64N8K-97Q62-YG401-01MGB-5M0G1-ZYDP2-W7MT4-X0000-00000-0HG62-04206-WVD72-ZMY1W-TMSVF-QVPBP-4GE34-MCDN0-2978M-Q7X7Z-G81G5-0XE0M-W045W-0GBZW-MA2CQ-TSB40-00000-009RK-0
```

## "Rust check" (2026-10-05, on v68 or later) -- heard 2026-10-07: no difference (Firefox, desktop)

Six loops that lean on the ported voices: kalimba (tracks 1 and 4),
fiddle (2 and 5), pad (3 and 6). Played twice, once on the main site and
once with `?engine=rust`. Mikey listens for any difference, clicks or
dropouts, and checks Diagnostics reads `engine: rust  late: 0` on the
Rust pass. Not blind: the URL and Diagnostics show the engine (see
State).

```
DLA1-0C554-XBKEG-G66T3-5CDNG-01G09-G2GG4-0G0PR-HYT5W-DPBVS-0Z8Q8-TZ3RQ-ZH7QN-RYPD4-EQG00-086M1-GP489-505CE-080ZZ-NVHE5-FDGXG-00000-00008-G810C-0R0Y2-2RNHC-2WFRY-HX7FG-75KNJ-ZPXNZ-GWGE1-9V000-08F04-0D7GY-K0214-5NR0G-0YW3G-HSMFP-SRQ08-80000-00000-6M1G8-60G0E-EC8QC-8RA84-G97YM-B09RX-NQZV9-XGA09-XNJ00-004YC-1G2A0-87C5S-R0R1R-81J20-0WT62-VJX4A-5C000-00000-01E0G-93060-H3XJ5-7HZJJ-BSAMW-S4427-R4JRM-GQC5N-Y1VCG-0002Y-20GCX-04HE0-R43M1-DW0R4-V1DAR-R681C-00000-00005-G2R22-080NK-QQS59-PS9AK-PP4BP-H4D4E-WC0TG-QW08F-ZM800-06C60-8FZW1-01WR1-1KMVB-E34BR-GG000-00000-05810-G8100-D7R3V-CHHKT-ZEKM0-81D57-ZZHD1-7S2HG-H2RZ0-000RE-G30B0-G82R5-681G5-80590-1HDHJ-RG4RB-J3000-00000-5V1G
```

## "Rust, all voices" (2026-10-09, on v77 or later) -- heard 2026-10-11: "it sounded great!"

Every voice now plays from the Rust core behind `?engine=rust` (queue
items 23-28). Ten short loops, one per family of newly ported sounds:
1 hum; 2 choir (vowel, three singers); 3 keys over a full kit; 4 moog
lead; 5 pan flute; 6 fiddle with strummed nylon; 7 music box and harp;
8 prepared piano and kalimba; 9 accordion over the hand kit (frame, tap,
jingle); 10 the waves texture. Bass and drums are spread across them.
Played twice: once on the main site, once with `?engine=rust`. Listen
for any difference, clicks or dropouts; on the Rust pass Diagnostics
should read `engine: rust  late: 0  fallback: 0`. **Since v81 (items
29-31) the Rust pass also runs the whole mix in the core** -- reverb,
echo, wobble, saturator, both compressors -- so this one album now
checks everything; no second album is needed. Labeled, not blind:
the URL and Diagnostics show the engine. Best heard on the phone.

```
DLA1-0C854-XBKEG-P20RB-CDGG7-CVV9C-DJQ60-0A00D-GJ008-20GVB-ZXJ7F-14MDQ-PSCF8-N9KMK-H3T7T-XY7C6-N6000-BKD04-2T80Y-VG609-40EKG-EDD6G-SXMSA-AT000-00000-00ZGM-10820-28TTQ-V0XWN-Z04SP-F95VN-F2R2T-NY15C-B1N8J-00FYD-4G802-V1C5G-JPR77-R103P-R74JZ-7NEVX-MMS00-00000-000J8-70C40-R0PC4-8K6WA-J62KJ-D8FW5-CTBHQ-9YV42-9TD3T-90003-VTR30-G60D7-8DAR1-GAB86-500AN-GWNQ2-S92KG-00000-00001-W1GP1-0G1Z4-YFW6N-KR4EJ-9T6SD-DZ28P-2BVMF-362CK-3X000-CJ601-GY804-786A8-085ZY-A4F6B-4PCYG-00000-0000S-87088-1034G-4KEND-YP3N6-604V2-GNT76-9MBMW-5C1CV-Y6004-1H6G2-1Z9G0-B0302-RG6E8-62QBT-NADTA-CQ000-00000-00S09-0M20R-2CGV0-BJFS6-HQ4RC-KCVRW-8RVJS-5V006-KQ69W-0045C-Y021V-N0E58-303G0-66020-YZVDC-3BCWR-00000-00000-E8A0C-4104N-R0GSY-QHVBT-K98BG-Y4ZT4-784D9-FTXYV-S1400-0HCX0-107ZG-60PK0-01GAA-EMSJK-6VN97-00000-00000-N0C08-2204C-BDC68-DMD82-KEAN0-H38C3-K41NE-F7B8J-4JP00-1T070-42GJ0-ZPG60-HS057-G0XXZ-K6SS9-3AQ00-00000-001K0-J0G81-G3WB6-3W9K8-CP8Y3-TZ19G-33AK4-XSQXW-7RPPX-W003Q-VZ023-FZ042-FZ7JS-SJ1A2-3R000-00000-05M4G-640C3-XZDSQ-71E84-NNR0H-07Q47-WP98V-VMXEK-W1AH0-005SM-W101R-RD3G1-07G86-7TP8X-1M1NN-X0000-00001-QEG
```

## "Depth two" (2026-09-28, on v64 or later)

Six 16-bar loops, four developing and two simple, shuffled. Key:
`developmentOf(spec)`. Rated "goes somewhere", "loops" or "too busy", as
the first depth album was. Tests item 17's new 16-bar form (brain's
measure: 8.8 distinct melody bars developing, 6.7 simple).

```
DLA1-0C4M8-SBGEH-M20X3-QDW00-C0371-C1104-0DKEQ-6NT6T-B4SNC-JMWQV-ERJNX-RSMWB-JZ7Y1-YG0S6-CV047-ZY0G1-7M1C5-QEEP1-YNM8G-00000-00006-41GJ4-0G238-32W39-6Z7JA-FPJME-68CW8-PQ3YT-TTE8F-ZT0BJ-YJA02-01Q82-180H2-0R708-2PJ0C-PQ1NV-9C64F-G0000-00000-5J180-2060V-5MME2-SEA6T-VK2BH-YCMW7-8TSQ5-ZBKD3-MC826-TGG1R-0G9YM-3GM0R-31R27-0041Q-Y6BZD-5GC40-00080-0001G-01G00-J0000-00001-T1082-080HB-6TKM9-XWJ9H-84EX7-RSDN5-3Q99V-58B7P-ASGJR-3RDR0-GF105-ZE0G6-ZR003-2JWSH-MEA40-00000-00008-42G44-0C2V6-TNYC4-W2HCW-AG3V5-97T7S-MD9M9-AG4S7-1HPEH-QA801-033R4-E00G1-ZZBQ2-W5K02-E0000-00000-0CGG4-GG201-CHWSG-EV4PX-SPWKH-32RC0-6AJQY-8H2SE-RSS3H-HH0F6-041H2-0BEG4-1ME0N-RRWMW-2D303-20000-00016-4C
```
