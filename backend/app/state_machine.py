import re


def normalize_project_name(value: str) -> str:
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", " ", value).strip()
    return re.sub(r"\s+", " ", value)


def is_project_name_match(candidate: str, project_name: str) -> bool:
    a = normalize_project_name(candidate)
    b = normalize_project_name(project_name)
    return bool(a and b and a == b)


def is_person_name_match(candidate: str, expected: str) -> bool:
    return is_project_name_match(candidate, expected)


def parse_verification_details(value: str) -> dict:
    lines = [line.strip() for line in re.split(r"\r?\n", value) if line.strip()]
    full_name_line = next((l for l in lines if re.match(r"^full\s*name\s*:", l, re.I)), None)
    project_line = next((l for l in lines if re.match(r"^project\s*:", l, re.I)), None)
    full_name = re.sub(r"^full\s*name\s*:\s*", "", full_name_line, flags=re.I).strip() if full_name_line else (lines[0] if lines else "")
    project_name = re.sub(r"^project\s*:\s*", "", project_line, flags=re.I).strip() if project_line else (lines[1] if len(lines) > 1 else "")
    return {"fullName": full_name, "projectName": project_name}


def parse_positive_integer(value: str) -> int | None:
    match = re.search(r"\d+", value)
    if not match:
        return None
    number = int(match.group(0))
    return number if 0 < number < 200 else None


def parse_floor_names(value: str, expected: int) -> dict:
    parts = re.split(r"\r?\n|,", value)
    names = [re.sub(r"^\d+[\).\-\s]+", "", p).strip() for p in parts]
    names = [n for n in names if n]
    if len(names) != expected:
        return {"ok": False, "names": names, "error": f"Expected {expected} floor names, received {len(names)}."}
    return {"ok": True, "names": names}


def parse_bind_command(text: str) -> str | None:
    match = re.match(r"^/bind(?:@\w+)?\s+([A-Za-z0-9_-]+)\s*$", text.strip(), re.I)
    return match.group(1).upper() if match else None


def parse_start_payload(text: str) -> str | None:
    match = re.match(r"^/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]+))?\s*$", text.strip(), re.I)
    return match.group(1) if match and match.group(1) else None


def normalize_telegram_username(username: str | None) -> str:
    if not username:
        return ""
    return username.strip().lstrip("@").lower()


def normalize_project_code(value: str) -> str:
    return value.strip().upper()
