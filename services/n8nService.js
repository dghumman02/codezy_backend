import fetch from "node-fetch";

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

export const callN8N = async (type, payload) => {
  try {
    const body = JSON.stringify({
      action_type: type,        // main workflow expects action_type
      user_id: payload.teacherId || payload.studentId || "system",
      role: payload.role || (type === "validate_lab" ? "teacher" : type === "analyze_code" ? "student" : "individual_learner"),
      ...payload
    });
    
    console.log("📤 Sending to n8n:");
    console.log("   URL:", N8N_WEBHOOK_URL);
    console.log("   Body:", body);

    const response = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    });

    console.log("📥 n8n response status:", response.status);

    const text = await response.text();
    console.log("📥 n8n raw response:", text);

    if (!response.ok) {
      throw new Error(`n8n responded with status ${response.status}: ${text}`);
    }

    const data = JSON.parse(text);
    return data;
  } catch (err) {
    console.error(`❌ n8n call failed for type "${type}":`, err.message);
    throw err;
  }
};