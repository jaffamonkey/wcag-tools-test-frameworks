from pathlib import Path
import sys
import json

from service.job_runner_stub import prepare_job

def main():
    if len(sys.argv) != 3:
        print("Usage: python run_job.py <job_dir> <job_config.json>")
        raise SystemExit(1)

    job_dir = Path(sys.argv[1])
    config_path = Path(sys.argv[2])

    prepare_job(job_dir, config_path)

    status_path = job_dir / "status.json"
    if status_path.exists():
        status = json.loads(status_path.read_text(encoding="utf-8"))
        if status.get("auth_success"):
            print(f"Prepared job: {job_dir}")
            print("Authentication succeeded.")
        else:
            print(f"Prepared job: {job_dir}")
            print("Authentication failed.")
            print(f"Message: {status.get('message')}")
    else:
        print(f"Prepared job: {job_dir}")
if __name__ == "__main__":
    main()
