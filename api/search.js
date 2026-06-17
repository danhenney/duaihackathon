import { searchLocal } from "./_core.js";

export default function handler(request, response) {
  response.status(200).json({ results: searchLocal(request.query.q || "") });
}
