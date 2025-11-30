/**
 * Generate Synthetic Training Data Command
 *
 * Generates diverse, multi-language synthetic emails for training models
 */

import { logger } from '../../utils/logger.ts';
import { parseArgs, getOption, hasFlag, type ParsedArgs } from '../../utils/args.ts';
import * as fs from 'fs';
import * as path from 'path';

// Expanded multi-language name database (50+ cultures)
const namesByCulture: Record<string, { first: string[]; last: string[] }> = {
  english: {
    first: ["James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda", "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica"],
    last: ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas"]
  },
  spanish: {
    first: ["José", "María", "Antonio", "Carmen", "Manuel", "Ana", "Francisco", "Isabel", "Luis", "Dolores", "Carlos", "Pilar", "Juan", "Teresa", "Pedro", "Rosa"],
    last: ["García", "Rodríguez", "Martínez", "López", "González", "Pérez", "Sánchez", "Ramírez", "Torres", "Flores", "Rivera", "Gómez", "Díaz", "Cruz", "Morales", "Reyes"]
  },
  chinese: {
    first: ["Wei", "Fang", "Ming", "Li", "Jun", "Hui", "Qiang", "Jing", "Yan", "Ling", "Hao", "Xiao", "Lei", "Na", "Bo", "Mei"],
    last: ["Wang", "Li", "Zhang", "Liu", "Chen", "Yang", "Huang", "Zhao", "Wu", "Zhou", "Xu", "Sun", "Ma", "Zhu", "Hu", "Guo"]
  },
  arabic: {
    first: ["Ahmed", "Fatima", "Mohammed", "Aisha", "Ali", "Zahra", "Omar", "Noor", "Hassan", "Amina", "Khalid", "Layla", "Yusuf", "Mariam", "Karim", "Sara"],
    last: ["Al-Hashimi", "Al-Farsi", "Al-Mansouri", "Al-Zaabi", "Al-Dhaheri", "Al-Mazrouei", "Al-Shamsi", "Al-Blooshi", "Al-Muhairi", "Al-Kaabi", "Al-Suwaidi", "Al-Ahbabi"]
  },
  russian: {
    first: ["Dmitri", "Natasha", "Ivan", "Olga", "Sergei", "Elena", "Alexei", "Maria", "Andrei", "Tatiana", "Vladimir", "Anna", "Mikhail", "Svetlana", "Nikolai", "Irina"],
    last: ["Ivanov", "Petrov", "Sidorov", "Popov", "Kuznetsov", "Smirnov", "Sokolov", "Volkov", "Kozlov", "Morozov", "Novikov", "Fedorov", "Mikhailov", "Solovyov"]
  },
  german: {
    first: ["Hans", "Anna", "Klaus", "Maria", "Peter", "Emma", "Wolfgang", "Sophie", "Michael", "Lisa", "Thomas", "Julia", "Andreas", "Laura", "Stefan", "Sarah"],
    last: ["Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker", "Schulz", "Hoffman", "Koch", "Bauer", "Richter", "Klein", "Wolf", "Schröder"]
  },
  french: {
    first: ["Jean", "Marie", "Pierre", "Sophie", "Michel", "Claire", "Philippe", "Anne", "Jacques", "Isabelle", "François", "Nathalie", "Alain", "Christine", "Bernard", "Sylvie"],
    last: ["Martin", "Bernard", "Dubois", "Thomas", "Robert", "Richard", "Petit", "Durand", "Leroy", "Moreau", "Simon", "Laurent", "Lefebvre", "Michel", "Garcia", "David"]
  },
  italian: {
    first: ["Marco", "Giulia", "Paolo", "Francesca", "Andrea", "Chiara", "Alessandro", "Valentina", "Giuseppe", "Elena", "Matteo", "Sara", "Luca", "Martina", "Giovanni", "Alessandra"],
    last: ["Rossi", "Russo", "Ferrari", "Esposito", "Bianchi", "Romano", "Colombo", "Ricci", "Marino", "Greco", "Bruno", "Gallo", "Conti", "De Luca", "Mancini", "Costa"]
  },
  japanese: {
    first: ["Yuki", "Hana", "Haruto", "Yui", "Sota", "Aoi", "Riku", "Hina", "Kaito", "Sakura", "Yuuto", "Rin", "Kouki", "Saki", "Shouta", "Mio"],
    last: ["Sato", "Suzuki", "Takahashi", "Tanaka", "Watanabe", "Ito", "Yamamoto", "Nakamura", "Kobayashi", "Kato", "Yoshida", "Yamada", "Sasaki", "Yamaguchi", "Saito", "Matsumoto"]
  },
  korean: {
    first: ["Min-jun", "Seo-yeon", "Ji-hoon", "Seo-jun", "Ye-jun", "Ji-woo", "Do-yoon", "Ha-yoon", "Seo-a", "Yu-jin", "Ju-won", "Min-seo", "Si-woo", "Ye-eun", "Hyeon-woo", "Soo-ah"],
    last: ["Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Cho", "Yoon", "Jang", "Lim", "Han", "Oh", "Seo", "Shin", "Kwon", "Song"]
  },
  portuguese: {
    first: ["João", "Maria", "António", "Ana", "José", "Mariana", "Carlos", "Sofia", "Manuel", "Beatriz", "Pedro", "Inês", "Francisco", "Catarina", "Miguel", "Rita"],
    last: ["Silva", "Santos", "Ferreira", "Oliveira", "Costa", "Rodrigues", "Martins", "Jesus", "Sousa", "Fernandes", "Pereira", "Carvalho", "Gomes", "Almeida", "Lopes", "Ribeiro"]
  },
  dutch: {
    first: ["Jan", "Emma", "Pieter", "Sophie", "Lars", "Julia", "Sem", "Anna", "Daan", "Eva", "Luuk", "Lisa", "Bram", "Sanne", "Tim", "Fleur"],
    last: ["de Jong", "Jansen", "de Vries", "van den Berg", "van Dijk", "Bakker", "Janssen", "Visser", "Smit", "Meijer", "de Boer", "Mulder", "de Groot", "Bos", "Vos", "Peters"]
  },
  polish: {
    first: ["Jan", "Anna", "Piotr", "Maria", "Krzysztof", "Katarzyna", "Andrzej", "Magdalena", "Tomasz", "Agnieszka", "Paweł", "Barbara", "Michał", "Ewa", "Marcin", "Joanna"],
    last: ["Nowak", "Kowalski", "Wiśniewski", "Wójcik", "Kowalczyk", "Kamiński", "Lewandowski", "Zieliński", "Szymański", "Woźniak", "Dąbrowski", "Kozłowski", "Jankowski", "Mazur"]
  },
  indian: {
    first: ["Raj", "Priya", "Amit", "Pooja", "Rahul", "Sneha", "Arjun", "Anjali", "Rohan", "Neha", "Vikram", "Kavya", "Aditya", "Riya", "Siddharth", "Divya"],
    last: ["Sharma", "Verma", "Singh", "Kumar", "Patel", "Desai", "Reddy", "Gupta", "Mehta", "Iyer", "Agarwal", "Nair", "Rao", "Joshi", "Pillai", "Shah"]
  },
  swedish: {
    first: ["Erik", "Emma", "Carl", "Anna", "Oscar", "Maria", "Lars", "Sofia", "Anders", "Linnea", "Johan", "Elin", "Gustav", "Sara", "Magnus", "Ida"],
    last: ["Andersson", "Johansson", "Karlsson", "Nilsson", "Eriksson", "Larsson", "Olsson", "Persson", "Svensson", "Gustafsson", "Pettersson", "Jonsson", "Jansson", "Hansson"]
  },
  turkish: {
    first: ["Mehmet", "Ayşe", "Mustafa", "Fatma", "Ahmet", "Emine", "Ali", "Hatice", "Hasan", "Zeynep", "Hüseyin", "Elif", "İbrahim", "Merve", "Can", "Yasemin"],
    last: ["Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Yıldız", "Yıldırım", "Öztürk", "Aydın", "Özdemir", "Arslan", "Doğan", "Kılıç", "Aslan", "Çetin", "Kara"]
  },
  greek: {
    first: ["Dimitris", "Maria", "Nikos", "Eleni", "Yiannis", "Anna", "Kostas", "Sofia", "Giorgos", "Katerina", "Andreas", "Ioanna", "Christos", "Vasiliki", "Panagiotis", "Despina"],
    last: ["Papadopoulos", "Georgiou", "Dimitriou", "Nikolaou", "Ioannou", "Petrou", "Christodoulou", "Konstantinou", "Athanasiou", "Alexandrou", "Michail", "Stavrou", "Makris"]
  },
  vietnamese: {
    first: ["Minh", "Hoa", "Tuan", "Lan", "Dung", "Mai", "Hung", "Linh", "Nam", "Huong", "Anh", "Thao", "Khoi", "Nga", "Quan", "Phuong"],
    last: ["Nguyen", "Tran", "Le", "Pham", "Hoang", "Phan", "Vu", "Dang", "Bui", "Do", "Ngo", "Duong", "Ly", "Vo", "Truong", "Dinh"]
  },
  thai: {
    first: ["Somchai", "Suda", "Niran", "Wassana", "Surasak", "Naree", "Anan", "Duangjai", "Boonmee", "Malee", "Chatchai", "Sommai", "Preecha", "Boonma", "Thawee", "Pornthip"],
    last: ["Suwannarat", "Boonma", "Suwan", "Thongchai", "Chaiwong", "Pattana", "Rattana", "Navin", "Sooksai", "Suwan", "Prasert", "Chaiyaporn", "Mongkol", "Wichai"]
  },
  filipino: {
    first: ["Jose", "Maria", "Juan", "Ana", "Pedro", "Teresa", "Manuel", "Carmen", "Francisco", "Rosa", "Antonio", "Isabel", "Carlos", "Luz", "Miguel", "Elena"],
    last: ["Reyes", "Santos", "Garcia", "Cruz", "Bautista", "Ramos", "Mendoza", "Flores", "Gonzales", "Torres", "Rivera", "Lopez", "Castillo", "Villanueva", "Aquino", "Fernandez"]
  },
  norwegian: {
    first: ["Lars", "Ingrid", "Ole", "Anne", "Erik", "Kari", "Per", "Marit", "Bjørn", "Liv", "Jan", "Solveig", "Knut", "Astrid", "Arne", "Randi"],
    last: ["Hansen", "Johansen", "Olsen", "Larsen", "Andersen", "Pedersen", "Nilsen", "Kristiansen", "Jensen", "Karlsen", "Johnsen", "Pettersen", "Eriksen", "Berg", "Haugen"]
  },
  finnish: {
    first: ["Juha", "Maria", "Matti", "Anna", "Mikko", "Kaarina", "Jari", "Helena", "Pekka", "Liisa", "Timo", "Pirjo", "Kari", "Tuula", "Heikki", "Riitta"],
    last: ["Korhonen", "Virtanen", "Mäkinen", "Nieminen", "Mäkelä", "Hämäläinen", "Laine", "Heikkinen", "Koskinen", "Järvinen", "Lehtonen", "Lehtinen", "Saarinen", "Salminen"]
  },
  czech: {
    first: ["Jan", "Marie", "Petr", "Anna", "Pavel", "Lenka", "Martin", "Eva", "Tomáš", "Hana", "Jiří", "Věra", "Josef", "Jana", "Michal", "Petra"],
    last: ["Novák", "Svoboda", "Novotný", "Dvořák", "Černý", "Procházka", "Kučera", "Veselý", "Horák", "Němec", "Marek", "Pospíšil", "Pokorný", "Hájek", "Jelínek"]
  },
  hungarian: {
    first: ["László", "Mária", "István", "Éva", "János", "Anna", "Zoltán", "Katalin", "Gábor", "Erzsébet", "Péter", "Ilona", "András", "Judit", "Ferenc", "Margit"],
    last: ["Nagy", "Kovács", "Tóth", "Szabó", "Horváth", "Varga", "Kiss", "Molnár", "Németh", "Farkas", "Balogh", "Papp", "Takács", "Juhász", "Lakatos", "Mészáros"]
  },
  romanian: {
    first: ["Ion", "Maria", "Gheorghe", "Elena", "Nicolae", "Ana", "Vasile", "Ioana", "Constantin", "Mihaela", "Alexandru", "Andreea", "Mihai", "Georgiana", "Adrian", "Cristina"],
    last: ["Popescu", "Ionescu", "Popa", "Radu", "Dumitrescu", "Stanescu", "Stoica", "Georgescu", "Constantin", "Munteanu", "Dima", "Dobre", "Marin", "Iordache", "Nistor"]
  },
  hebrew: {
    first: ["David", "Sarah", "Michael", "Rachel", "Jonathan", "Miriam", "Daniel", "Leah", "Joseph", "Rebecca", "Benjamin", "Esther", "Jacob", "Hannah", "Samuel", "Deborah"],
    last: ["Cohen", "Levi", "Mizrahi", "Peretz", "Biton", "Dahan", "Avraham", "Friedman", "Azoulay", "Katz", "Ben-David", "Mor", "Yosef", "Stein", "Levy", "Shapiro"]
  },
  persian: {
    first: ["Mohammad", "Fatemeh", "Ali", "Zahra", "Hassan", "Maryam", "Hossein", "Atefeh", "Reza", "Narges", "Mehdi", "Somayeh", "Ahmad", "Mina", "Hamid", "Sara"],
    last: ["Hosseini", "Ahmadi", "Mohammadi", "Rezaei", "Moradi", "Karimi", "Azizi", "Jafari", "Rahimi", "Mousavi", "Kazemi", "Sadeghi", "Rostami", "Hashemi", "Bagheri"]
  },
  indonesian: {
    first: ["Budi", "Sari", "Ahmad", "Dewi", "Agus", "Rina", "Andi", "Fitri", "Yudi", "Nuri", "Hadi", "Ratna", "Doni", "Lina", "Rizki", "Wati"],
    last: ["Setiawan", "Wijaya", "Santoso", "Kurniawan", "Purnama", "Susanto", "Pratama", "Wibowo", "Saputra", "Hidayat", "Gunawan", "Firmansyah", "Nugroho", "Utomo", "Kusuma"]
  },
  swahili: {
    first: ["Juma", "Amina", "Hassan", "Fatuma", "Ali", "Zainab", "Omar", "Halima", "Salim", "Mariam", "Rashid", "Rehema", "Hamisi", "Asha", "Bakari", "Saada"],
    last: ["Mwangi", "Otieno", "Ochieng", "Kimani", "Kamau", "Wanjiru", "Njoroge", "Maina", "Kariuki", "Wairimu", "Muthoni", "Wambui", "Githinji", "Karanja", "Ndung'u"]
  },
  yoruba: {
    first: ["Oluwaseun", "Folake", "Babatunde", "Yetunde", "Ademola", "Bukola", "Olumide", "Funmilayo", "Adebayo", "Bisi", "Oluwatoyin", "Adeola", "Olufemi", "Funke", "Akinola", "Jumoke"],
    last: ["Adeyemi", "Ogunleye", "Adekunle", "Olawale", "Adesanya", "Ogunbiyi", "Oladele", "Ajayi", "Ogundele", "Adebiyi", "Ayodele", "Ogunsola", "Adejumo", "Olaniyan"]
  },
  zulu: {
    first: ["Sipho", "Thembi", "Thabo", "Nomsa", "Bongani", "Zanele", "Mandla", "Nandi", "Lucky", "Thandi", "Sbu", "Zinhle", "Mpho", "Nokuthula", "Jabulani", "Lindiwe"],
    last: ["Nkosi", "Dlamini", "Mkhize", "Zulu", "Ngubane", "Mthembu", "Khoza", "Sithole", "Ndlovu", "Khumalo", "Mbatha", "Ntuli", "Buthelezi", "Gumede", "Shabalala", "Sibiya"]
  },
};

// Culture-specific email domains
const cultureDomains: Record<string, string[]> = {
  english: ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com"],
  spanish: ["gmail.com", "hotmail.com", "yahoo.es", "outlook.com", "hotmail.es"],
  chinese: ["qq.com", "163.com", "gmail.com", "sina.com", "126.com", "yeah.net"],
  arabic: ["gmail.com", "hotmail.com", "yahoo.com", "outlook.com"],
  russian: ["mail.ru", "yandex.ru", "gmail.com", "rambler.ru", "bk.ru"],
  german: ["gmail.com", "gmx.de", "web.de", "t-online.de", "freenet.de"],
  french: ["gmail.com", "hotmail.fr", "orange.fr", "yahoo.fr", "laposte.net", "free.fr"],
  italian: ["gmail.com", "hotmail.it", "libero.it", "yahoo.it", "virgilio.it", "tiscali.it"],
  japanese: ["gmail.com", "yahoo.co.jp", "docomo.ne.jp", "ezweb.ne.jp", "softbank.jp"],
  korean: ["gmail.com", "naver.com", "daum.net", "hanmail.net", "nate.com"],
  portuguese: ["gmail.com", "hotmail.com", "sapo.pt", "yahoo.com", "iol.pt"],
  dutch: ["gmail.com", "hotmail.com", "ziggo.nl", "live.nl", "xs4all.nl", "planet.nl"],
  polish: ["gmail.com", "wp.pl", "o2.pl", "onet.pl", "interia.pl", "poczta.fm"],
  indian: ["gmail.com", "yahoo.co.in", "rediffmail.com", "hotmail.com", "ymail.com"],
  swedish: ["gmail.com", "hotmail.com", "telia.com", "bredband.net", "live.se"],
  turkish: ["gmail.com", "hotmail.com", "yandex.com.tr", "mynet.com", "outlook.com"],
  greek: ["gmail.com", "yahoo.gr", "hotmail.com", "otenet.gr", "forthnet.gr"],
  vietnamese: ["gmail.com", "yahoo.com.vn", "ymail.com", "hotmail.com"],
  thai: ["gmail.com", "hotmail.com", "yahoo.com", "outlook.com"],
  filipino: ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"],
  norwegian: ["gmail.com", "hotmail.no", "online.no", "yahoo.no"],
  finnish: ["gmail.com", "hotmail.fi", "luukku.com", "suomi24.fi"],
  czech: ["gmail.com", "seznam.cz", "centrum.cz", "email.cz", "volny.cz"],
  hungarian: ["gmail.com", "freemail.hu", "citromail.hu", "hotmail.com"],
  romanian: ["gmail.com", "yahoo.com", "hotmail.com", "mail.com"],
  hebrew: ["gmail.com", "walla.co.il", "yahoo.com", "hotmail.com"],
  persian: ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"],
  indonesian: ["gmail.com", "yahoo.co.id", "ymail.com", "hotmail.com"],
  swahili: ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"],
  yoruba: ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"],
  zulu: ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"],
};

// Disposable/temporary email domains
const disposableDomains = [
  "10minutemail.com", "guerrillamail.com", "mailinator.com", "tempmail.com",
  "throwaway.email", "trashmail.com", "getnada.com", "temp-mail.org",
  "maildrop.cc", "sharklasers.com", "yopmail.com", "mintemail.com",
  "fakeinbox.com", "tempinbox.com", "mohmal.com", "dispostable.com"
];

// Typosquatted domains (common fraud technique)
const typosquattedDomains = [
  "gmai1.com", "gmial.com", "gmal.com", "yaho0.com", "yahooo.com",
  "hotmai1.com", "hotmial.com", "outl0ok.com", "outlok.com",
  "gmaiil.com", "yahho.com", "hotnail.com", "0utlook.com"
];

const vpnDomains = [
  "vpn-mail.net", "secure-node.io", "exitrelay.net", "privacy-mail.org", "fastproxymail.com"
];

const aiSyllables = [
  "zor", "vex", "lum", "qir", "aex", "nem", "tal", "syn", "qu", "viz", "dra", "pha", "ion", "rak", "umi"
];

const nearMissTags = ["verify", "account", "profile", "secure", "support", "update", "review", "edge", "client", "signin"];

const NEAR_MISS_LEGIT_RATIO = 0.2;

const homoglyphMap: Record<string, string[]> = {
  a: ['a', '@', '4'],
  e: ['e', '3'],
  i: ['i', '1', 'l'],
  o: ['o', '0'],
  s: ['s', '5'],
  l: ['l', '1'],
  t: ['t', '7'],
  g: ['g', '9'],
};

// Accent removal for email addresses
function removeAccents(text: string): string {
  const accents: Record<string, string> = {
    'á': 'a', 'à': 'a', 'â': 'a', 'ä': 'a', 'ã': 'a',
    'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
    'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
    'ó': 'o', 'ò': 'o', 'ô': 'o', 'ö': 'o', 'õ': 'o',
    'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
    'ñ': 'n', 'ç': 'c', 'ß': 'ss',
    'Á': 'A', 'À': 'A', 'Â': 'A', 'Ä': 'A', 'Ã': 'A',
    'É': 'E', 'È': 'E', 'Ê': 'E', 'Ë': 'E',
    'Í': 'I', 'Ì': 'I', 'Î': 'I', 'Ï': 'I',
    'Ó': 'O', 'Ò': 'O', 'Ô': 'O', 'Ö': 'O', 'Õ': 'O',
    'Ú': 'U', 'Ù': 'U', 'Û': 'U', 'Ü': 'U',
    'Ñ': 'N', 'Ç': 'C',
    'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ś': 's', 'ź': 'z', 'ż': 'z',
    'Ą': 'A', 'Ć': 'C', 'Ę': 'E', 'Ł': 'L', 'Ń': 'N', 'Ś': 'S', 'Ź': 'Z', 'Ż': 'Z',
    'ş': 's', 'ğ': 'g', 'ı': 'i', 'İ': 'I', 'Ş': 'S', 'Ğ': 'G',
    'ø': 'o', 'å': 'a', 'æ': 'ae', 'Ø': 'O', 'Å': 'A', 'Æ': 'AE',
    'ě': 'e', 'š': 's', 'č': 'c', 'ř': 'r', 'ž': 'z', 'ý': 'y', 'ů': 'u', 'ť': 't', 'ď': 'd',
    'Ě': 'E', 'Š': 'S', 'Č': 'C', 'Ř': 'R', 'Ž': 'Z', 'Ý': 'Y', 'Ů': 'U', 'Ť': 'T', 'Ď': 'D',
    'ő': 'o', 'ű': 'u', 'Ő': 'O', 'Ű': 'U',
  };

  return text.split('').map(char => accents[char] || char).join('');
}

function applyHomoglyphs(text: string): string {
  return text
    .split('')
    .map((char) => {
      const lower = char.toLowerCase();
      if (homoglyphMap[lower]) {
        const replacements = homoglyphMap[lower];
        return replacements[Math.floor(Math.random() * replacements.length)];
      }
      return char;
    })
    .join('');
}

// Random helper
function randomChoice<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

// Generate legitimate email
function generateLegitEmail(culture: string): { email: string; name: string } {
  const names = namesByCulture[culture];
  const domains = cultureDomains[culture];

  const first = randomChoice(names.first);
  const last = randomChoice(names.last);
  const domain = randomChoice(domains);

  // Various legitimate formats
  const formats = [
    (f: string, l: string) => `${removeAccents(f.toLowerCase())}.${removeAccents(l.toLowerCase())}`,
    (f: string, l: string) => `${removeAccents(f.toLowerCase())}${removeAccents(l.toLowerCase())[0]}`,
    (f: string, l: string) => `${removeAccents(f.toLowerCase())}_${removeAccents(l.toLowerCase())}`,
    (f: string, l: string) => `${removeAccents(f.toLowerCase())}${Math.floor(Math.random() * 100)}`,
    (f: string, l: string) => `${removeAccents(f.toLowerCase()[0])}${removeAccents(l.toLowerCase())}`,
    (f: string, l: string) => `${removeAccents(l.toLowerCase())}.${removeAccents(f.toLowerCase())}`,
    (f: string, l: string) => `${removeAccents(f.toLowerCase())}${removeAccents(l.toLowerCase())}`,
  ];

  const local = randomChoice(formats)(first, last);
  const email = `${local}@${domain}`;
  const name = `${first} ${last}`;

  return { email, name };
}

// Generate sequential fraud pattern
function generateSequentialFraud(culture: string): { email: string; name: string } {
  const names = namesByCulture[culture];
  const domains = cultureDomains[culture];

  const first = randomChoice(names.first);
  const last = randomChoice(names.last);
  const domain = randomChoice(domains);

  const patterns = [
    `user${Math.floor(Math.random() * 10000)}`,
    `test${Math.floor(Math.random() * 10000)}`,
    `admin${Math.floor(Math.random() * 1000)}`,
    `mail${Math.floor(Math.random() * 1000)}`,
    `info${Math.floor(Math.random() * 1000)}`,
    `support${Math.floor(Math.random() * 1000)}`,
    `contact${Math.floor(Math.random() * 1000)}`,
  ];

  const local = randomChoice(patterns);
  const email = `${local}@${domain}`;
  const name = `${first} ${last}`;

  return { email, name };
}

// Generate gibberish fraud pattern
function generateGibberishFraud(culture: string): { email: string; name: string } {
  const names = namesByCulture[culture];
  const domains = cultureDomains[culture];

  const first = randomChoice(names.first);
  const last = randomChoice(names.last);
  const domain = randomChoice(domains);

  // Random consonant-vowel patterns
  const consonants = "bcdfghjklmnpqrstvwxyz";
  const vowels = "aeiou";

  const length = Math.floor(Math.random() * 7) + 6;
  let gibberish = "";
  for (let i = 0; i < length; i++) {
    if (i % 2 === 0) {
      gibberish += randomChoice(consonants.split(''));
    } else {
      gibberish += randomChoice(vowels.split(''));
    }
  }

  const email = `${gibberish}@${domain}`;
  const name = `${first} ${last}`;

  return { email, name };
}

// Generate dated fraud pattern
function generateDatedFraud(culture: string): { email: string; name: string } {
  const names = namesByCulture[culture];
  const domains = cultureDomains[culture];

  const first = randomChoice(names.first);
  const last = randomChoice(names.last);
  const domain = randomChoice(domains);

  const year = Math.floor(Math.random() * 51) + 1960; // 1960-2010

  const patterns = [
    (f: string, l: string, y: number) => `${removeAccents(f.toLowerCase())}.${removeAccents(l.toLowerCase())}${y}`,
    (f: string, l: string, y: number) => `${removeAccents(f.toLowerCase())}${removeAccents(l.toLowerCase())}${y}`,
    (f: string, l: string, y: number) => `${removeAccents(f.toLowerCase())}_${removeAccents(l.toLowerCase())}${y}`,
    (f: string, l: string, y: number) => `${removeAccents(l.toLowerCase())}.${removeAccents(f.toLowerCase())}${y}`,
    (f: string, l: string, y: number) => `${removeAccents(f.toLowerCase())}${y}`,
    (f: string, l: string, y: number) => `${removeAccents(l.toLowerCase())}${y}`,
  ];

  const local = randomChoice(patterns)(first, last, year);
  const email = `${local}@${domain}`;
  const name = `${first} ${last}`;

  return { email, name };
}

// Generate disposable domain fraud
function generateDisposableFraud(culture: string): { email: string; name: string } {
  const names = namesByCulture[culture];

  const first = randomChoice(names.first);
  const last = randomChoice(names.last);
  const domain = randomChoice(disposableDomains);

  const patterns = [
    (f: string, l: string) => `${removeAccents(f.toLowerCase())}.${removeAccents(l.toLowerCase())}`,
    (f: string, l: string) => `${removeAccents(f.toLowerCase())}${removeAccents(l.toLowerCase())}`,
    (f: string, l: string) => `${removeAccents(f.toLowerCase())}_${removeAccents(l.toLowerCase())}`,
    (f: string, l: string) => `${removeAccents(f.toLowerCase())}${Math.floor(Math.random() * 100)}`,
  ];

  const local = randomChoice(patterns)(first, last);
  const email = `${local}@${domain}`;
  const name = `${first} ${last}`;

  return { email, name };
}

// Generate plus addressing abuse fraud (user+spam@domain.com)
function generatePlusAddressingFraud(culture: string): { email: string; name: string } {
  const names = namesByCulture[culture];
  const domains = cultureDomains[culture];

  const first = randomChoice(names.first);
  const last = randomChoice(names.last);
  const domain = randomChoice(domains);

  const plusTags = ["spam", "test", "bulk", "promo", "temp", "trial", "free", "offer", "deal", "signup"];
  const tag = randomChoice(plusTags);

  const basePatterns = [
    (f: string, l: string) => `${removeAccents(f.toLowerCase())}.${removeAccents(l.toLowerCase())}`,
    (f: string, l: string) => `${removeAccents(f.toLowerCase())}${removeAccents(l.toLowerCase())}`,
    (f: string, l: string) => `${removeAccents(f.toLowerCase())}`,
  ];

  const base = randomChoice(basePatterns)(first, last);
  const email = `${base}+${tag}@${domain}`;
  const name = `${first} ${last}`;

  return { email, name };
}

// Generate keyboard walk patterns (qwerty@, asdfgh@)
function generateKeyboardWalkFraud(culture: string): { email: string; name: string } {
  const names = namesByCulture[culture];
  const domains = cultureDomains[culture];

  const first = randomChoice(names.first);
  const last = randomChoice(names.last);
  const domain = randomChoice(domains);

  const keyboardPatterns = [
    "qwerty", "asdfgh", "zxcvbn", "qazwsx", "wsxedc", "rfvtgb",
    "123456", "asdfg", "qwert", "zxcv", "1234", "qwe123", "asd123",
    "qwertyuiop", "asdfghjkl", "zxcvbnm", "123qwe", "qwe456"
  ];

  const pattern = randomChoice(keyboardPatterns);
  const email = `${pattern}@${domain}`;
  const name = `${first} ${last}`;

  return { email, name };
}

// Generate repeated character patterns (aaaa123@, test1111@)
function generateRepeatedCharFraud(culture: string): { email: string; name: string } {
  const names = namesByCulture[culture];
  const domains = cultureDomains[culture];

  const first = randomChoice(names.first);
  const last = randomChoice(names.last);
  const domain = randomChoice(domains);

  const chars = "abcdefghijklmnopqrstuvwxyz";
  const char = randomChoice(chars.split(''));
  const repeatCount = Math.floor(Math.random() * 4) + 4; // 4-7 repetitions
  const num = Math.floor(Math.random() * 10000);

  const patterns = [
    () => `${char.repeat(repeatCount)}${num}`,
    () => `${char.repeat(repeatCount)}`,
    () => `test${num.toString().charAt(0).repeat(4)}`,
    () => `user${num.toString().charAt(0).repeat(4)}`,
    () => `${removeAccents(first.toLowerCase())}${num.toString().charAt(0).repeat(3)}`,
  ];

  const local = randomChoice(patterns)();
  const email = `${local}@${domain}`;
  const name = `${first} ${last}`;

  return { email, name };
}

// Generate mixed case random patterns (TeSt@, UsEr123@)
function generateMixedCaseFraud(culture: string): { email: string; name: string } {
  const names = namesByCulture[culture];
  const domains = cultureDomains[culture];

  const first = randomChoice(names.first);
  const last = randomChoice(names.last);
  const domain = randomChoice(domains);

  const baseWords = ["test", "user", "admin", "mail", "info", "demo", "temp"];
  const base = randomChoice(baseWords);

  // Randomly capitalize characters
  let mixedCase = "";
  for (let i = 0; i < base.length; i++) {
    mixedCase += Math.random() > 0.5 ? base[i].toUpperCase() : base[i].toLowerCase();
  }

  const num = Math.floor(Math.random() * 1000);
  const patterns = [
    () => mixedCase,
    () => `${mixedCase}${num}`,
    () => `${mixedCase}${num}${mixedCase}`,
  ];

  const local = randomChoice(patterns)();
  const email = `${local}@${domain}`;
  const name = `${first} ${last}`;

  return { email, name };
}

// Generate heavy number prefix/suffix (123456user@, user999999@)
function generateHeavyNumberFraud(culture: string): { email: string; name: string } {
  const names = namesByCulture[culture];
  const domains = cultureDomains[culture];

  const first = randomChoice(names.first);
  const last = randomChoice(names.last);
  const domain = randomChoice(domains);

  const baseWords = ["user", "test", "mail", "email", "account", "demo"];
  const base = randomChoice(baseWords);
  const heavyNum = Math.floor(Math.random() * 900000) + 100000; // 6-digit number

  const patterns = [
    () => `${heavyNum}${base}`,
    () => `${base}${heavyNum}`,
    () => `${heavyNum}`,
    () => `${base}${heavyNum}${base}`,
  ];

  const local = randomChoice(patterns)();
  const email = `${local}@${domain}`;
  const name = `${first} ${last}`;

  return { email, name };
}

// Generate typosquatted domain fraud (gmai1.com, yaho0.com)
function generateTyposquattedDomainFraud(culture: string): { email: string; name: string } {
  const names = namesByCulture[culture];

  const first = randomChoice(names.first);
  const last = randomChoice(names.last);
  const domain = randomChoice(typosquattedDomains);

  const patterns = [
    (f: string, l: string) => `${removeAccents(f.toLowerCase())}.${removeAccents(l.toLowerCase())}`,
    (f: string, l: string) => `${removeAccents(f.toLowerCase())}${removeAccents(l.toLowerCase())}`,
    (f: string, l: string) => `${removeAccents(f.toLowerCase())}_${removeAccents(l.toLowerCase())}`,
    (f: string, l: string) => `${removeAccents(f.toLowerCase())}${Math.floor(Math.random() * 100)}`,
  ];

  const local = randomChoice(patterns)(first, last);
  const email = `${local}@${domain}`;
  const name = `${first} ${last}`;

  return { email, name };
}

function generateVpnProxyFraud(culture: string): { email: string; name: string } {
  const names = namesByCulture[culture];
  const first = randomChoice(names.first);
  const last = randomChoice(names.last);
  const ip = Array.from({ length: 4 }, () => Math.floor(Math.random() * 220) + 10).join('-');
  const markers = ['vpn', 'proxy', 'exit', 'tor', 'node'];
  const prefix = `${randomChoice(markers)}-${ip}-${Math.floor(Math.random() * 999)}`;
  const domain = randomChoice(vpnDomains);
  const email = `${prefix}@${domain}`;
  const name = `${first} ${last}`;
  return { email, name };
}

function generateHomoglyphFraud(culture: string): { email: string; name: string } {
  const names = namesByCulture[culture];
  const first = removeAccents(randomChoice(names.first).toLowerCase());
  const last = removeAccents(randomChoice(names.last).toLowerCase());
  const domain = randomChoice(cultureDomains[culture] || ['gmail.com', 'outlook.com']);
  const base = `${first}.${last}`;
  const mutated = applyHomoglyphs(base);
  const email = `${mutated}@${domain}`;
  const name = `${randomChoice(names.first)} ${randomChoice(names.last)}`;
  return { email, name };
}

function generateAIGibberishFraud(_culture: string): { email: string; name: string } {
  const length = Math.floor(Math.random() * 4) + 3;
  const chunks: string[] = [];
  for (let i = 0; i < length; i++) {
    const syllable = randomChoice(aiSyllables);
    chunks.push(Math.random() < 0.4 ? syllable.toUpperCase() : syllable);
    if (Math.random() < 0.3) {
      chunks.push(String(Math.floor(Math.random() * 10)));
    }
  }
  const local = chunks.join('');
  const domains = [...disposableDomains, ...vpnDomains, 'mail.ai', 'llm-mail.com'];
  const email = `${local}@${randomChoice(domains)}`;
  return { email, name: 'Synthetic Agent' };
}

function generateNearMissLegitEmail(culture: string): { email: string; name: string } {
  const names = namesByCulture[culture];
  const first = randomChoice(names.first);
  const last = randomChoice(names.last);
  const base = removeAccents(`${first}.${last}`.toLowerCase());
  const tag = randomChoice(nearMissTags);
  const separator = randomChoice(['-', '_', '.']);
  const noisySuffix = `${tag}${separator}${Math.floor(Math.random() * 9000 + 1000)}`;
  const domainPool = [...(cultureDomains[culture] || []), 'outlook.com', 'gmail.com'];
  const email = `${base}${separator}${noisySuffix}@${randomChoice(domainPool)}`;
  const name = `${first} ${last}`;
  return { email, name };
}

async function execute(args: ParsedArgs) {
  console.log('============================================================');
  console.log('  🎲 Generating Synthetic Training Data');
  console.log('============================================================\n');

  // Parse arguments
  const count = parseInt(getOption(args, 'count') || '20000');
  const output = getOption(args, 'output') || 'data/synthetic-training.csv';
  const legitRatio = parseFloat(getOption(args, 'legit-ratio') || '0.7');
  const seed = parseInt(getOption(args, 'seed') || String(Date.now()));
  const append = hasFlag(args, 'append');

  // Set random seed
  Math.random = (() => {
    let x = seed;
    return () => {
      x = (x * 9301 + 49297) % 233280;
      return x / 233280;
    };
  })();

  const legitCount = Math.floor(count * legitRatio);
  const fraudCount = count - legitCount;

  logger.info(`Configuration:`);
  logger.info(`  Total:      ${count.toLocaleString()}`);
  logger.info(`  Legitimate: ${legitCount.toLocaleString()} (${(legitRatio * 100).toFixed(1)}%)`);
  logger.info(`  Fraud:      ${fraudCount.toLocaleString()} (${((1 - legitRatio) * 100).toFixed(1)}%)`);
  logger.info(`  Cultures:   ${Object.keys(namesByCulture).length}`);
  logger.info(`  Output:     ${output}`);
  logger.info(`  Mode:       ${append ? 'append' : 'overwrite'}`);
  logger.info(`  Seed:       ${seed}`);
  console.log('');

  const cultures = Object.keys(namesByCulture);
  const emails: Array<{ email: string; name: string; label: string; source: string }> = [];

  // Generate legitimate emails
  logger.info(`Generating ${legitCount.toLocaleString()} legitimate emails...`);
  for (let i = 0; i < legitCount; i++) {
    if ((i + 1) % 5000 === 0 || i === legitCount - 1) {
      logger.info(`  Generated ${(i + 1).toLocaleString()}/${legitCount.toLocaleString()} legitimate emails`);
    }
    const culture = randomChoice(cultures);
    const useNearMiss = Math.random() < NEAR_MISS_LEGIT_RATIO;
    const { email, name } = useNearMiss ? generateNearMissLegitEmail(culture) : generateLegitEmail(culture);
    emails.push({
      email,
      name,
      label: 'legitimate',
      source: useNearMiss ? 'synthetic_near_legit' : 'synthetic_legit',
    });
  }

  // Generate fraud emails
  logger.info(`Generating ${fraudCount.toLocaleString()} fraud emails...`);
  const fraudGenerators = [
    generateSequentialFraud,
    generateGibberishFraud,
    generateDatedFraud,
    generateDisposableFraud,
    generatePlusAddressingFraud,
    generateKeyboardWalkFraud,
    generateRepeatedCharFraud,
    generateMixedCaseFraud,
    generateHeavyNumberFraud,
    generateTyposquattedDomainFraud,
    generateVpnProxyFraud,
    generateHomoglyphFraud,
    generateAIGibberishFraud,
  ];

  for (let i = 0; i < fraudCount; i++) {
    if ((i + 1) % 2000 === 0 || i === fraudCount - 1) {
      logger.info(`  Generated ${(i + 1).toLocaleString()}/${fraudCount.toLocaleString()} fraud emails`);
    }
    const culture = randomChoice(cultures);
    const generator = randomChoice(fraudGenerators);
    const { email, name } = generator(culture);
    emails.push({ email, name, label: 'fraud', source: 'synthetic' });
  }

  // Shuffle the emails
  logger.info('Shuffling emails...');
  for (let i = emails.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [emails[i], emails[j]] = [emails[j], emails[i]];
  }

  // Write to CSV
  logger.info(`\nWriting to ${output}...`);

  // Ensure directory exists
  const dir = path.dirname(output);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Read existing data if appending
  let existingData: string[] = [];
  if (append && fs.existsSync(output)) {
    const existing = fs.readFileSync(output, 'utf-8');
    existingData = existing.split('\n').slice(1).filter(line => line.trim());
    logger.info(`  Appending to existing ${existingData.length} rows`);
  }

  // Write CSV
  const csvLines = [
    'email,name,label',
    ...existingData,
    ...emails.map(e => `${e.email},${e.name},${e.label}`)
  ];

  fs.writeFileSync(output, csvLines.join('\n'), 'utf-8');

  const totalRows = existingData.length + emails.length;

  console.log('');
  logger.success(`✅ Generated ${emails.length.toLocaleString()} synthetic emails`);
  logger.info(`   Legitimate: ${legitCount.toLocaleString()} (${(legitRatio * 100).toFixed(1)}%)`);
  logger.info(`   Fraud: ${fraudCount.toLocaleString()} (${((1 - legitRatio) * 100).toFixed(1)}%)`);
  if (append && existingData.length > 0) {
    logger.info(`   Total rows: ${totalRows.toLocaleString()} (${existingData.length.toLocaleString()} existing + ${emails.length.toLocaleString()} new)`);
  }
  logger.success(`\n✅ Data ready at: ${output}`);
}

// Default export for CLI
export default async function(rawArgs: string[], command: string) {
  const parsed = parseArgs(rawArgs);
  await execute(parsed);
}
