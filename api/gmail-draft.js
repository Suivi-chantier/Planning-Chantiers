// api/gmail-draft.js — Vercel serverless function
// Crée un brouillon Gmail via l'API Anthropic + MCP Gmail
// Ce fichier doit être placé dans le dossier /api/ à la racine du repo

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { subject, body } = req.body;
  if (!subject || !body) {
    return res.status(400).json({ error: 'subject and body are required' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured in Vercel environment variables' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'mcp-client-1.0'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        system: 'Tu es un assistant qui crée des brouillons Gmail. Quand on te donne un sujet et un corps de mail, utilise immédiatement l\'outil Gmail create_draft pour créer le brouillon. Ne réponds qu\'après avoir créé le brouillon.',
        messages: [{
          role: 'user',
          content: `Crée un brouillon Gmail avec:\nSujet: ${subject}\nCorps:\n${body}`
        }],
        mcp_servers: [{
          type: 'url',
          url: 'https://gmailmcp.googleapis.com/mcp/v1',
          name: 'gmail'
        }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(response.status).json({ error: `Anthropic API: ${response.status}`, detail: errText });
    }

    const data = await response.json();
    return res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error('Error creating Gmail draft:', err);
    return res.status(500).json({ error: err.message });
  }
}
