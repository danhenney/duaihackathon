# 사라했제

투자 인플루언서, 연예인, 방송인이 공개적으로 특정 종목이나 코인에 긍정 의견을 낸 시점부터 현재까지의 수익률을 추적하는 해커톤 데모입니다.

## Run

```powershell
npm start
```

Open `http://localhost:5177`.

## Deploy to Vercel

```powershell
npx vercel --prod --yes --token $env:VERCEL_TOKEN
```

## Environment

```powershell
$env:DATABASE_URL="postgresql://..."
```

현재 검색은 라이브 크롤링이 아니라 검증해 저장한 데이터와 시드 데이터만 대상으로 합니다.
