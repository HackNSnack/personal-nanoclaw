

- Hva er sluttproduktet for casen?
- Hvilken skyleverandør bruker dere mest?
- Har dere reflektert rundt risiko over valg av skyleverandører?
	- I.e.: Azure har som regel latest & greatest LLM tech, GCP og AWS følger etter
	- Valg av noe annet enn Azure kan legge performance på bordet

- Chained approach eller speech2speech?
	- Speech2speech - lavest latency, "føles" ut som man prater med en "person"
	- Speech2text2speech - høyere latency, men mer fleksibelt spillerom; flere modeller, mer prosessering


# Timeboks oppgaven til 2 dager


# Notater

- reg nr, posisjon, selskap dekket av
- Hva har skjedd? Sit rep.

Basert på dette, vi kan hjelp dem.
Mye henvendelser på tlf og web, starter prosessen

- Vi vil alltid ha et stort volum på tlf, fok ringer ofte
- Folk ofte satt i kø, vi svarer innen 60 sek

- "Ønsker du å registrere med vår AI løsning?"
- Hvis du har klart å registrere innen 60 sekunder, når aldri mennesket
- På kundens premisser, risikerer ikke dårlig rykte eller opplevelse

## Premisser: (KRAV)

1. Dynamisk samtale-flow
2. Kunne avbrytes/korrigeres

## Kundeflow:

- Kunde sier reg nr.
- Må valideres; hvordan i dag?
	- I dag - kundebehandler skriver inn nr
	- Framtid - agenten henter ut fra API

Løs med MCP:

krav:
1. Bruk MCP;
	1. Host <-> MCP <-> API

API:
- GET reg. nr.
	- Valider tilbake og bekreft tilbake til kunde
- GET event
	- Kategorier: (definer ~10 forskjellige)
		- Punktering
		- Kollisjon
		- Utelåst fra kjøretøy
	- AGENT: map til en av disse kategoriene, hvis det ikke finnes - sett til uspesifisert
	- Gjennom hvert steg - validering; blir dette riktig?
- På norsk
- Modell? Kan velge

- livekit lett å inkludere i telefontjenestene våre

# Resultat

1. Demo
2. Presentasjon;
	1. utfordringer
	2. Mulig?
	3. Er det en vei til produkt i produksjon som er greit nok til at vi kna teste?
	4. Hvilke overordnede steg for å komme seg dit?



# Teknisk Leveranse


1. Teknisk Demo om:
	1. Talebot med MCP + endepunkt
2. Presentasjon (par slides)
	1. Veien videre
	2. Hva må skje for å ha et produkt?
	3. Utfordringer?
	4. Er det levedyktig
3. Forklar hva som er gjort

