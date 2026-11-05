"""Input rules for sign-up fields. Each check returns a Korean message for the UI, or None."""

import re
import unicodedata

LOGIN_ID_RE = re.compile(r"^[a-z0-9_]{4,20}$")
NICKNAME_RE = re.compile(r"^[가-힣A-Za-z0-9]{2,12}$")
PASSWORD_MIN = 8
# Argon2 accepts any length; the cap only bounds hashing work per request.
PASSWORD_MAX = 128

RESERVED_LOGIN_IDS = {
    "admin", "administrator", "root", "system", "support", "help", "api", "www", "ggumiroom", "ggumi",
    "official", "staff", "moderator", "null", "undefined",
}

# Minimal list; matched as substrings of the lowercased nickname.
BANNED_NICKNAME_PARTS = (
    "관리자", "운영자", "운영팀", "꾸미룸운영", "admin", "operator", "ggumiroom",
    "시발", "씨발", "씨바", "병신", "븅신", "좆", "개새", "지랄", "염병", "니미", "애미", "애비", "섹스",
    "fuck", "shit", "bitch", "sex", "porn",
)

COMMON_PASSWORDS = {
    "12345678", "123456789", "1234567890", "password", "password1", "password12", "password123",
    "qwerty123", "qwertyuiop", "11111111", "00000000", "88888888", "abcd1234", "abcdefgh", "iloveyou",
    "1q2w3e4r", "1q2w3e4r5t", "q1w2e3r4", "qwer1234", "asdf1234", "zxcv1234", "asdfasdf", "qwerasdf",
    "a1234567", "aa123456", "letmein1", "welcome1", "admin123", "sunshine", "princess", "football",
    "baseball", "dragon12", "monkey12", "superman", "starwars", "whatever", "trustno1", "passw0rd",
    "p@ssw0rd", "1qaz2wsx", "zaq12wsx", "qazwsxedc", "!qaz2wsx", "ggumiroom", "ggumi1234",
}


def normalize_login_id(value: str) -> str:
    return value.strip().lower()


def login_id_error(login_id: str) -> str | None:
    if not LOGIN_ID_RE.fullmatch(login_id):
        return "아이디는 영문 소문자, 숫자, 밑줄(_)로 4~20자여야 해요."
    if login_id in RESERVED_LOGIN_IDS:
        return "사용할 수 없는 아이디예요."
    return None


def normalize_nickname(value: str) -> str:
    return unicodedata.normalize("NFC", value).strip()


def nickname_error(nickname: str) -> str | None:
    if not NICKNAME_RE.fullmatch(nickname):
        return "닉네임은 한글, 영문, 숫자로 2~12자여야 해요."
    lowered = nickname.lower()
    if any(part in lowered for part in BANNED_NICKNAME_PARTS):
        return "사용할 수 없는 단어가 들어 있어요."
    return None


def password_error(password: str, login_id: str = "") -> str | None:
    if len(password) < PASSWORD_MIN:
        return f"비밀번호는 {PASSWORD_MIN}자 이상이어야 해요."
    if len(password) > PASSWORD_MAX:
        return f"비밀번호는 {PASSWORD_MAX}자 이하여야 해요."
    if password.lower() in COMMON_PASSWORDS:
        return "너무 흔한 비밀번호예요. 다른 비밀번호를 써 주세요."
    if len(set(password)) < 4:
        return "같은 글자가 너무 많이 반복돼요."
    if login_id and login_id in password.lower():
        return "비밀번호에 아이디를 넣을 수 없어요."
    return None
