#!/usr/bin/env python3
"""Join Schoolinfo disclosure exports to the map's school snapshot."""

import argparse
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path


LEVELS = {"초등학교": "02", "중학교": "03", "고등학교": "04"}
DISCLOSURE_ID = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", re.I)


def normalized(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value or ""))


def road(value):
    return normalized(re.split(r"[,(]", value or "", maxsplit=1)[0])


def campus_distance(school, row):
    lon, lat = row.get("LGTUD"), row.get("LTTUD")
    if not all(isinstance(value, (int, float)) for value in (lon, lat)):
        return math.inf
    north = school["la"] - lat
    east = (school["lo"] - lon) * math.cos(math.radians(school["la"]))
    return math.hypot(north, east) * 111_195


def match_campus(school, candidates):
    address = road(school["address"])
    exact = [row for row in candidates if address and address == road(row.get("SCHUL_RDNMA"))]
    if len(exact) == 1:
        return exact[0]
    nearby = [row for row in (exact or candidates) if campus_distance(school, row) <= 180]
    return nearby[0] if len(nearby) == 1 else None


def read_rows(folder, year, level, category):
    rows = json.loads((folder / f"{year}-{level}-{category}.json").read_text(encoding="utf-8"))["list"]
    if not rows:
        raise ValueError(f"No rows for {year}-{level}-{category}")
    return rows


def school_profile(basic, current, previous, grades):
    profile = {}
    disclosure = basic.get("SHL_IDF_CD") or ""
    if DISCLOSURE_ID.fullmatch(disclosure):
        profile["disclosureId"] = disclosure
    if basic.get("FOND_SC_CODE"):
        profile["establishment"] = basic["FOND_SC_CODE"]
    if basic.get("HS_KND_SC_NM"):
        profile["highSchoolType"] = basic["HS_KND_SC_NM"]

    if current and current.get("PBAN_EXCP_YN") != "Y":
        profile.update(
            students=current["COL_S_SUM"],
            classes=current["COL_C_SUM"],
            teachers=current["TEACH_CNT"],
            studentsPerClass=current["COL_SUM"],
            grades=[[current.get(f"COL_S{grade}"), current.get(f"COL_C{grade}")] for grade in range(1, grades + 1)],
        )
        if previous and previous.get("PBAN_EXCP_YN") != "Y":
            profile["previousStudents"] = previous["COL_S_SUM"]
    return profile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("exports", type=Path, help="Folder containing the official JSON downloads")
    parser.add_argument("--year", required=True, type=int)
    args = parser.parse_args()

    repo = Path(__file__).resolve().parents[1]
    first_line = (repo / "dist/places.js").read_text(encoding="utf-8").splitlines()[0]
    schools = json.loads(first_line.removeprefix("const schoolPlaces=").removesuffix(";"))
    output = repo / "dist/school-details"
    output.mkdir(exist_ok=True)

    candidates = defaultdict(list)
    current, previous = {}, {}
    for level in LEVELS.values():
        for row in read_rows(args.exports, args.year, level, "0"):
            if row.get("CLOSE_YN") != "Y" and row.get("ABSCH_YN") != "Y":
                candidates[level, normalized(row["SCHUL_NM"])].append(row)
        current.update(
            (row["SCHUL_CODE"], row) for row in read_rows(args.exports, args.year, level, "09")
        )
        previous.update(
            (row["SCHUL_CODE"], row) for row in read_rows(args.exports, args.year - 1, level, "09")
        )

    provinces = {school["p"]: {} for school in schools}
    totals = Counter()
    for school in schools:
        level = LEVELS[school["level"]]
        basic = match_campus(school, candidates[level, normalized(school["name"])])
        if not basic:
            totals["unmatched"] += 1
            continue
        code = basic["SCHUL_CODE"]
        profile = school_profile(basic, current.get(code), previous.get(code), 6 if level == "02" else 3)
        provinces[school["p"]][school["id"]] = profile
        totals["matched"] += 1
        totals["enrollment"] += "students" in profile
        totals["comparison"] += "previousStudents" in profile

    for province, profiles in provinces.items():
        if "/" in province or "\\" in province:
            raise ValueError(f"Invalid province name: {province}")
        disclosure = {"year": args.year, "previousYear": args.year - 1, "schools": profiles}
        data = json.dumps(disclosure, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        (output / f"{province}.json").write_text(data + "\n", encoding="utf-8")
    print(dict(totals))


if __name__ == "__main__":
    main()
