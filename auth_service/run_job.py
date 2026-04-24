from pathlib import Path
import sys
from service.job_runner_stub import prepare_job
def main():
    if len(sys.argv) != 3:
        print("Usage: python run_job.py <job_dir> <job_config.json>")
        raise SystemExit(1)
    prepare_job(Path(sys.argv[1]), Path(sys.argv[2]))
    print(f"Prepared job: {Path(sys.argv[1])}")
if __name__ == "__main__":
    main()
