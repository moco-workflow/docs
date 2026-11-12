* simple multi-step workflow
```yaml
wfspec_name: web_crawler
input_data:
  content_url: https://www.
body:
  sequence:
    elements:
      # read from content_url
      - activity:
          type: http.get

      # use LLM to summarize
      -

      # send email
      -
```

* human-in-the-loop approval workflow using state machine

```yaml
wfspec_name: state-machine-basics-demo
context:
  history: []
  score: 0

input_data:
  # Drives which branch the review takes
  quality_score: 80
  approval_threshold: 70

output_data:
  final_state: '{{final_state}}'
  history: '{{history}}'

body:
  state_machine:
    initial_state: draft
    output_name: final_state
    states:
      - name: draft
        on_enter:
          transform:
            name: enter-draft
            output_data:
              - _t: '{{ history.append("entered draft") }}'
        on_exit:
          transform:
            name: leave-draft
            output_data:
              - _t: '{{ history.append("left draft") }}'

      - name: in_review
        on_enter:
          sequence:
            elements:
              - transform:
                  name: enter-review
                  output_data:
                    - _t: '{{ history.append("entered in_review") }}'
                    - score: '{{ quality_score }}'

      - name: approved
        is_terminal: true
        on_enter:
          transform:
            name: enter-approved
            output_data:
              - _t: '{{ history.append("approved with score " + str(score)) }}'

      - name: rejected
        is_terminal: true
        on_enter:
          transform:
            name: enter-rejected
            output_data:
              - _t: '{{ history.append("rejected with score " + str(score)) }}'

    transitions:
      - from_state: draft
        to_state: in_review
        trigger:
          # empty trigger cause automatic transit from 'draft' to 'in_review' state.
          # uncomment the following to make the machine waiting for extenal 'submit' event.
          # event_type: submit

      # The two branches out of in_review are mutually exclusive and total.
      - from_state: in_review
        to_state: approved
        trigger:
          condition: '{{ score >= approval_threshold }}'

      - from_state: in_review
        to_state: rejected
        trigger:
          condition: '{{ score < approval_threshold }}'

```
