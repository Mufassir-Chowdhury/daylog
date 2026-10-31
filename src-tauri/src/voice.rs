//! Voice mode's audio, through ElevenLabs: speech to text and text to speech.
//! Audio is bytes, not text, so it doesn't go through `ai::fetch`; the key is
//! added here from the OS credential store just the same, and only
//! `api.elevenlabs.io` is reachable.

use crate::ai::{self, Provider};
use serde::Deserialize;

const API: &str = "https://api.elevenlabs.io/v1";

/// Ids and names that end up in a URL or a multipart header: letters, digits, `_` and `-`.
fn is_token(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

#[derive(Debug, Deserialize)]
pub struct SpeakRequest {
    voice_id: String,
    output_format: String,
    /// The JSON body (text, model_id, voice_settings), as the page built it.
    body: String,
}

/// Text to speech: the audio bytes (MP3).
pub fn speak(request: SpeakRequest) -> Result<Vec<u8>, String> {
    if !is_token(&request.voice_id, 64) || !is_token(&request.output_format, 32) {
        return Err("Bad voice or format".into());
    }
    let key = ai::get_key(Provider::Elevenlabs)?;
    let url = format!(
        "{API}/text-to-speech/{}/stream?output_format={}",
        request.voice_id, request.output_format
    );
    let mut response = ai::agent()
        .post(&url)
        .header(Provider::Elevenlabs.key_header(), &key)
        .header("content-type", "application/json")
        .header("accept", "audio/mpeg")
        .send(request.body)
        .map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let body = response
        .body_mut()
        .with_config()
        .limit(20 * 1024 * 1024)
        .read_to_vec()
        .map_err(|e| e.to_string())?;
    if status >= 400 {
        return Err(format!("HTTP {status}: {}", String::from_utf8_lossy(&body)));
    }
    Ok(body)
}

/// A multipart/form-data body with text fields and one file.
fn multipart(
    boundary: &str,
    fields: &[(&str, &str)],
    file: &[u8],
    file_name: &str,
    mime: &str,
) -> Vec<u8> {
    let mut out = Vec::with_capacity(file.len() + 512);
    for (name, value) in fields {
        out.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
            )
            .as_bytes(),
        );
    }
    out.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\nContent-Type: {mime}\r\n\r\n"
        )
        .as_bytes(),
    );
    out.extend_from_slice(file);
    out.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    out
}

/// Speech to text: ElevenLabs' JSON answer, or `HTTP <status>: …` so the page can react.
pub fn transcribe(
    audio: Vec<u8>,
    mime: &str,
    model: &str,
    language: Option<&str>,
) -> Result<String, String> {
    let mime_ok = !mime.is_empty()
        && mime.len() <= 64
        && mime
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "/;=-+._ ".contains(c));
    if !is_token(model, 40) || !mime_ok || language.is_some_and(|l| !is_token(l, 8)) {
        return Err("Bad model, language or audio type".into());
    }
    let key = ai::get_key(Provider::Elevenlabs)?;
    let boundary = format!(
        "daylog-{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos())
    );
    let mut fields = vec![("model_id", model)];
    if let Some(language) = language {
        fields.push(("language_code", language));
    }
    let ext = if mime.contains("mp4") { "m4a" } else { "webm" };
    let body = multipart(&boundary, &fields, &audio, &format!("speech.{ext}"), mime);
    let mut response = ai::agent()
        .post(&format!("{API}/speech-to-text"))
        .header(Provider::Elevenlabs.key_header(), &key)
        .header(
            "content-type",
            &format!("multipart/form-data; boundary={boundary}"),
        )
        .send(body)
        .map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let text = response
        .body_mut()
        .read_to_string()
        .map_err(|e| e.to_string())?;
    if status >= 400 {
        return Err(format!("HTTP {status}: {text}"));
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_ids_reach_the_url() {
        assert!(is_token("JBFqnCBsd6RMkjVDRZzb", 64));
        assert!(is_token("mp3_44100_128", 32));
        assert!(!is_token("../voices", 64));
        assert!(!is_token("a?b=c", 64));
        assert!(!is_token("", 64));
    }

    #[test]
    fn builds_a_multipart_body() {
        let body = multipart(
            "B",
            &[("model_id", "scribe_v2")],
            b"AUDIO",
            "speech.webm",
            "audio/webm",
        );
        let text = String::from_utf8(body).unwrap();
        assert_eq!(
            text,
            "--B\r\nContent-Disposition: form-data; name=\"model_id\"\r\n\r\nscribe_v2\r\n\
             --B\r\nContent-Disposition: form-data; name=\"file\"; filename=\"speech.webm\"\r\n\
             Content-Type: audio/webm\r\n\r\nAUDIO\r\n--B--\r\n"
        );
    }

    #[test]
    fn refuses_odd_inputs_before_sending() {
        assert!(transcribe(vec![], "audio/webm\r\nX: y", "scribe_v2", None).is_err());
        assert!(transcribe(vec![], "audio/webm", "scribe v2", None).is_err());
        assert!(speak(SpeakRequest {
            voice_id: "a/b".into(),
            output_format: "mp3_44100_128".into(),
            body: String::new()
        })
        .is_err());
    }
}
