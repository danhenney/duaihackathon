export default function handler(_request, response) {
  response.status(410).json({
    error: "live_search_disabled",
    message: "검색은 저장된 데이터에서만 동작합니다."
  });
}
