Feature: Full page audit of the-internet URLs
  In order to smoke test a set of public URLs
  As a QA engineer
  I want one full-page JSON report per URL

  Background:
    Given I prepare the report folder

  Scenario: Full page check for all URLs from file
    When I run a rich full page check for every URL in "urls.txt"
