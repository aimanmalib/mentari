<p align="center"><img src="brand/logo-512.png" width="112" height="112" alt="Mentari"></p>

<h1 align="center">Mentari</h1>

<p align="center"><a href="https://github.com/aimanmalib/mentari/actions/workflows/ci.yml"><img src="https://github.com/aimanmalib/mentari/actions/workflows/ci.yml/badge.svg" alt="CI"></a> <a href="https://github.com/aimanmalib/mentari/blob/main/LICENSE"><img src="https://img.shields.io/github/license/aimanmalib/mentari" alt="Lesen: Apache-2.0"></a> <img src="https://img.shields.io/badge/QoreChain-Diana%20testnet-22357e" alt="Testnet QoreChain Diana"></p>

<p align="center"><b>Sijil solar yang hanya boleh dibersarakan sekali: bakar dan resit awam berlaku bersama, atau tidak langsung.</b> · <i>Solar certificates you can retire only once: burn and public receipt land together, or not at all.</i><br>
<a href="https://mentari.sasateguh.com"><b>demo langsung</b></a> · <a href="#semak-dalam-3-langkah">semak dalam 3 langkah</a> · <a href="#jalankan">jalankan</a> · <a href="#had">had</a> · <a href="AI_USAGE.md">penggunaan AI</a> · <a href="deck/mentari-slides.pdf">slaid (PDF)</a> · <a href="README.md">English</a><br>
Dibina di Malaysia oleh <a href="https://aimanmalib.com">Aiman Malib</a> · <a href="https://sasateguh.com">Sasa Teguh</a></p>

<p align="center"><img src="docs/images/screenshot-desktop.png" width="640" alt="Halaman daftar Mentari di desktop: lejar EVM di kiri, buku resit Native di kanan, dan lencana di tengah yang menyatakan kedua-dua lejar sepakat, atas data sampel"> <img src="docs/images/screenshot-mobile.png" width="180" alt="Halaman daftar yang sama di iPhone, dengan label meter simulasi dan nota data sampel"></p>

Sijil tenaga hanya bernilai jika ia boleh dibersarakan sekali. Kebanyakan daftar menyimpan pembakaran dalam satu sistem
dan rekod awam dalam sistem lain, dan kedua-duanya boleh tersasar.

Mentari meletakkan kedua-duanya dalam satu transaksi di QoreChain. Membersarakan sijil membakarnya dalam kontrak EVM dan
menulis resit awam ke dalam kontrak Native melalui jambatan Cross-VM, dalam transaksi yang sama. Jika mana-mana pihak
gagal, kedua-duanya tidak berlaku. Setiap sijil bermula sebagai bacaan meter solar yang ditandatangani dengan ML-DSA-87,
yang kontrak semak dengan precompile `pqcVerify`. Sijil hanya boleh berpindah ke akaun yang sudah mendaftar kunci
pasca-kuantum.

Dibina untuk **Build Before Q-Day: The QoreChain Developer Fest**, trek Cross-VM. Saya membinanya semasa fest: komit
pertama ialah [`6012d2b`](https://github.com/aimanmalib/mentari/commit/6012d2b) pada 21 November 2026.

> **Keadaan hari ini.** Kontrak, ujian, pelayan dan laman sudah dibina. Kontrak belum berada di testnet kerana akaun
> ujian belum diberi dana. Sehingga itu, laman langsung memakai data sampel dan menyatakannya di setiap halaman, dan
> butang "Retire now" menjawab dengan kes sampel yang terakam. Alamat testnet, cincangan transaksi dan skrip `verify`
> datang bersama deploy.

## Semak dalam 3 langkah

1. Buka <https://mentari.sasateguh.com>. Halaman daftar menunjukkan lejar EVM dan buku resit Native bersebelahan, dan
   lencana yang menyemak persaraan terkini dengan resitnya.
2. Pergi ke **Try it**. "Retire now" membersarakan 500 Wh (jumlahnya dalam
   [`config/limits.json`](config/limits.json)), dan tiga butang kegagalan masing-masing mencuba panggilan cross-VM yang
   mesti gagal. Halaman menunjukkan kiraan resit di kedua-dua lejar sebelum dan selepas. Hari ini ia memakai data sampel.
3. Baca buktinya dalam kod. `contracts/test/` ada 115 ujian Foundry yang lulus, termasuk empat invarian, dan
   [`docs/TESTING.md`](docs/TESTING.md) menunjukkan setiap invarian menjadi merah bila kontrak sengaja dirosakkan.

## Cara ia berfungsi

- **Mencetak.** Pendaftar menambah sistem solar (meter, pengeluar, kapasiti) dengan tandatangan ML-DSA-87. Selepas itu,
  bacaan harian yang ditandatangani kunci ML-DSA-87 meter mencetak watt-jam kepada pengeluar. Bacaan kedua untuk hari
  yang sama, bacaan untuk hari ini atau masa depan, dan watt-jam melebihi had kapasiti sehari semuanya ditolak.
- **Memindah.** `transfer` hanya menghantar ke akaun yang kunci ML-DSA-87nya berdaftar di rantai dengan bukti pemilikan.
  Tiada `approve` atau `transferFrom`.
- **Membersarakan.** `retire` membakar dahulu, membina nota resit daripada medan bertaip, memanggil jambatan `0x…0901`,
  membaca id resit daripada jawapan dan menyimpannya. Peristiwa EVM menamakan resit Native, dan nota Native menamakan
  persaraan EVM, jadi sesiapa boleh memadankannya satu dengan satu.
- **Menunjukkan atomik.** `AtomicityProbe` ialah kontrak demo berasingan yang berlabel jelas. Ia menulis resit lalu
  berbalik, meminta kontrak Native menolak, dan memanggil kontrak Native yang tidak diluluskan tadbir urus. Setiap kes
  mesti meninggalkan kedua-dua lejar tanpa perubahan.
- **Membaca.** API REST QoreChain tiada pengepala CORS, jadi pelayan Node kecil menghidang laman dan memproksi senarai
  laluan baca-sahaja yang tetap. Ia juga menghantar transaksi demo daripada akaun demo yang berhad kadar.

Butiran lanjut (dalam bahasa Inggeris): [`docs/architecture.md`](docs/architecture.md), [`docs/threat-model.md`](docs/threat-model.md)
dan rekod keputusan dalam [`docs/decisions/`](docs/decisions/).

## Keperluan trek Cross-VM, dan di mana ia dipenuhi

| Keperluan (teks rasmi) | Di mana ia dipenuhi | Status |
| --- | --- | --- |
| "Build an application where an EVM contract atomically calls an approved Native contract." | [`Mentari.retire`](contracts/src/Mentari.sol) memanggil jambatan dengan mesej `record` untuk `qday-receipts`, yang ada dalam senarai dibenarkan testnet (cadangan tadbir urus 40, id kod 865) | Dalam kod dan ujian; kes testnet A selepas deploy |
| "A working EVM-to-Native call to an approved Native contract" | Kes A: satu persaraan yang menambah satu resit dengan pengirim alamat `qor1…` kontrak | Direkod dalam `evidence/` selepas deploy |
| "with atomic execution shown on testnet" | Kes B, C, D melalui [`AtomicityProbe`](contracts/src/AtomicityProbe.sol): kiraan resit sama sebelum dan selepas setiap kes | Diuji dengan jambatan tiruan; testnet selepas deploy |
| Repo awam, lesen, README | Repo ini, [Apache-2.0](LICENSE), fail ini | Siap |
| Alamat testnet | Buku resit `qor1xjayq5ev55tkzpml9klxwyshr7gdrha0nurha9jhm0f0gdckksgs3gltw8`; alamat Mentari dan AtomicityProbe masuk ke [`config/app.json`](config/app.json) | Alamat kontrak selepas deploy |
| "An AI_USAGE.md file documenting the workflow, the generated work and the human contribution" | [`AI_USAGE.md`](AI_USAGE.md) | Siap |

## Jalankan

Perlu Node.js 22, pnpm 12.9.1 dan git. Skrip ujian memasang Foundry yang dipin jika `forge` tiada.

```sh
git clone --recurse-submodules https://github.com/aimanmalib/mentari.git
cd mentari
pnpm install --frozen-lockfile
pnpm exec playwright install chromium webkit
bash scripts/gerbang-ujian.sh   # sama seperti CI
pnpm build && pnpm start        # laman di http://localhost:8080, data sampel
```

## Ujian

Dikira pada 22 November 2026 daripada larian tempatan, langkah yang sama dengan CI.

| Suite | Hasil |
| --- | --- |
| Foundry, `contracts/test/` | 115 lulus: 98 ujian unit, 16 ujian fuzz (512 larian setiap satu) dan satu suite invarian yang memegang 4 invarian (forge mengira suite itu sekali, jadi 98 + 16 + 1 = 115); liputan baris `contracts/src` 99 % |
| vitest, `server/test/` | 125 lulus |
| vitest, `web/test/` | 141 lulus |
| vitest, `scripts/test/` | 86 lulus |
| Playwright, `web/e2e/` | 10 lulus: laluan dompet dengan dompet tiruan QoreX, 5 kes dalam Chromium dan WebKit sebagai iPhone 13 |

Empat invarian: dicetak tolak dibersara sama dengan bekalan; bilangan persaraan sama dengan bilangan resit yang jambatan
terima daripada kontrak; id resit setiap persaraan unik dan menaik; tiada baki pada alamat tanpa kunci pasca-kuantum.

## Model ancaman, ringkas

- **Kunci klasik yang bocor.** Cetakan perlu tandatangan ML-DSA-87 meter, disemak dalam rantai. Kunci klasik sahaja
  tidak mencetak apa-apa.
- **Penerima tanpa kunci pasca-kuantum.** Akaun tanpa kunci berdaftar boleh dituntut oleh sesiapa yang memecahkan kunci
  klasiknya dahulu. Jadi `transfer` menolak akaun begitu.
- **Suntikan JSON melalui memo.** Memo dihadkan kepada 40 aksara daripada `[A-Za-z0-9 .:/#-]` dan nota dibina daripada
  medan bertaip, jadi memo tidak boleh mengubah mesej yang dihantar kepada kontrak Native.
- **Jambatan yang gagal atau senyap.** Balasan kosong atau tidak boleh dibaca, atau id resit yang tidak baharu,
  membalikkan persaraan.
- **Penyalahgunaan butang demo.** Satu permintaan pada satu masa, 5 setiap IP sejam, 40 sehari, dan suis henti, semuanya
  dalam [`config/limits.json`](config/limits.json).

Versi penuh dengan sumber (dalam bahasa Inggeris): [`docs/threat-model.md`](docs/threat-model.md).

## Had

- **Meter disimulasi.** Bacaan datang daripada model jam matahari berbenih. Tandatangan, kontrak dan rantai adalah
  sebenar; panel solarnya tidak.
- **Testnet sahaja.** Ini demo di testnet Diana, bukan skim sijil yang diiktiraf, dan sijilnya tiada nilai.
- **Belum dideploy.** Pada komit ini kontrak belum berada di testnet, jadi belum ada cincangan transaksi untuk
  ditunjukkan, dan laman memakai data sampel.
- **Pihak Native merekod, bukan menguatkuasa.** `qday-receipts` ialah buku resit kongsi dari bengkel. Sesiapa boleh
  menulis kepadanya; resit Mentari ialah yang pengirimnya kontrak Mentari.
- **Laluan dompet diuji dengan dompet tiruan sahaja.** "Bersarakan dari dompet anda sendiri" menyambung QoreX, meminta
  500 Wh daripada akaun demo dan bersara dari dompet. QoreX belum menandatangani transaksi EVM, jadi hari ini ia menolak
  langkah terakhir itu, dan laman menyatakannya. Ujian pelayar memakai dompet tiruan QoreX: profil `current` ditolak,
  profil `planned` menghantar `retire` ke kontrak. Saya belum mencubanya dengan sambungan sebenar
  ([ADR 0010](docs/decisions/0010-qorex-wallet-path.md)). "Retire now" tidak memerlukan dompet.
- **Tiada audit.** Kontrak ada ujian, fuzz dan invarian, bukan audit profesional.

## Pendedahan AI

Saya membina Mentari dengan ejen pengekodan AI (Claude Code). Hampir semua kod, ujian, dokumen dan imej dalam repo ini
dijana oleh mereka, di bawah pelan dan keputusan saya, dan disemak oleh gerbang automatik serta ejen penyemak berasingan
sebelum setiap komit diterima. [`AI_USAGE.md`](AI_USAGE.md) menerangkan aliran kerja, hasil yang dijana dan sumbangan saya.

## Kredit

- Contoh bengkel QoreChain dalam [qorechain/build-before-qday](https://github.com/qorechain/build-before-qday)
  (Apache-2.0): `workshop-2/01-qday-vault` untuk corak `pqcVerify` dan `pqcKeyStatus`, dan `workshop-3/02-cross-vm` untuk
  panggilan jambatan dan buku resit. Lihat [NOTICE](NOTICE).
- `@qorechain/sdk`, [Foundry](https://github.com/foundry-rs/foundry) dan forge-std, [Vite](https://vite.dev),
  [React](https://react.dev), [wagmi](https://wagmi.sh), [RainbowKit](https://rainbowkit.com),
  [vitest](https://vitest.dev), [Playwright](https://playwright.dev), TypeScript dan tsx.

## Lesen

[Apache-2.0](LICENSE). Kredit untuk corak yang diadaptasi dan pakej pihak ketiga ada dalam [NOTICE](NOTICE).

## Bekerja dengan Sasa Teguh

Saya membina projek ini. Saya menjalankan [Sasa Teguh](https://sasateguh.com), studio di Malaysia yang membina laman web yang ditemui di Google dan dalam jawapan AI, dan memasang sistem seperti ini untuk perniagaan.

[Tempah panggilan](https://sasateguh.com/book) · hello@sasateguh.com · [Lagi daripada Sasa Teguh](https://github.com/sasateguh)
