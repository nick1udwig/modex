import { useEffect, useMemo, useState } from 'react';
import type { ApprovalDecision, InteractionRequest } from '../app/types';

interface InteractionPromptProps {
  onApprovalDecision: (decision: ApprovalDecision) => void;
  onSubmitUserInput: (answers: Record<string, string[]>) => void;
  request: InteractionRequest;
}

export const InteractionPrompt = ({
  onApprovalDecision,
  onSubmitUserInput,
  request,
}: InteractionPromptProps) => {
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({});
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});

  useEffect(() => {
    setDraftAnswers({});
    setSelectedOptions({});
  }, [request.requestId]);

  const canSubmitUserInput = useMemo(() => {
    if (request.kind !== 'user-input') {
      return false;
    }

    return request.questions.every((question) => {
      const selected = selectedOptions[question.id]?.trim();
      const typed = draftAnswers[question.id]?.trim();

      if (question.options.length > 0 && !question.isOther) {
        return Boolean(selected);
      }

      return Boolean(selected || typed);
    });
  }, [draftAnswers, request, selectedOptions]);

  if (request.kind === 'approval') {
    return (
      <div className="interaction-request" aria-live="polite">
        <div className="interaction-request__eyebrow">Approval required</div>
        <h3 className="interaction-request__title">{request.title}</h3>
        <p className="interaction-request__message">{request.message}</p>

        {request.detailLines.length > 0 ? (
          <div className="interaction-request__details">
            {request.detailLines.map((line) => (
              <div key={line} className="interaction-request__detail">
                {line}
              </div>
            ))}
          </div>
        ) : null}

        <div className="interaction-request__actions">
          <button
            className="interaction-request__button interaction-request__button--primary"
            type="button"
            onClick={() => onApprovalDecision('accept')}
          >
            Yes
          </button>

          {request.execPolicyAmendment ? (
            <button
              className="interaction-request__button interaction-request__button--secondary"
              type="button"
              onClick={() =>
                onApprovalDecision({
                  acceptWithExecpolicyAmendment: {
                    execpolicy_amendment: request.execPolicyAmendment ?? [],
                  },
                })
              }
            >
              Allow similar commands
            </button>
          ) : null}

          {request.allowSessionDecision ? (
            <button
              className="interaction-request__button interaction-request__button--secondary"
              type="button"
              onClick={() => onApprovalDecision('acceptForSession')}
            >
              Yes for session
            </button>
          ) : null}

          {request.allowDeclineDecision ? (
            <button
              className="interaction-request__button interaction-request__button--danger"
              type="button"
              onClick={() => onApprovalDecision('decline')}
            >
              No
            </button>
          ) : null}

          {request.allowCancelDecision ? (
            <button
              className="interaction-request__button interaction-request__button--ghost"
              type="button"
              onClick={() => onApprovalDecision('cancel')}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const submitAnswers = () => {
    const answers = Object.fromEntries(
      request.questions
        .map((question) => {
          const values = [selectedOptions[question.id], draftAnswers[question.id]]
            .map((value) => value?.trim() ?? '')
            .filter((value, index, items) => value.length > 0 && items.indexOf(value) === index);

          return [question.id, values] as const;
        })
        .filter(([, values]) => values.length > 0),
    );

    onSubmitUserInput(answers);
  };

  return (
    <div className="interaction-request" aria-live="polite">
      <div className="interaction-request__eyebrow">More input needed</div>
      <h3 className="interaction-request__title">{request.title}</h3>

      <div className="interaction-request__questions">
        {request.questions.map((question) => (
          <div key={question.id} className="interaction-request__question">
            <div className="interaction-request__question-header">{question.header}</div>
            <p className="interaction-request__message">{question.question}</p>

            {question.options.length > 0 ? (
              <div className="interaction-request__options">
                {question.options.map((option) => {
                  const selected = selectedOptions[question.id] === option.label;

                  return (
                    <button
                      key={option.label}
                      className={`interaction-request__option ${
                        selected ? 'interaction-request__option--selected' : ''
                      }`}
                      type="button"
                      onClick={() =>
                        setSelectedOptions((current) => ({
                          ...current,
                          [question.id]: option.label,
                        }))
                      }
                    >
                      <span>{option.label}</span>
                      <small>{option.description}</small>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {question.isOther || question.options.length === 0 ? (
              <input
                className="interaction-request__input"
                type={question.isSecret ? 'password' : 'text'}
                value={draftAnswers[question.id] ?? ''}
                placeholder={question.isOther ? 'Other answer' : 'Answer'}
                onChange={(event) =>
                  setDraftAnswers((current) => ({
                    ...current,
                    [question.id]: event.target.value,
                  }))
                }
              />
            ) : null}
          </div>
        ))}
      </div>

      <div className="interaction-request__actions">
        <button
          className="interaction-request__button interaction-request__button--primary"
          type="button"
          disabled={!canSubmitUserInput}
          onClick={submitAnswers}
        >
          Submit
        </button>
      </div>
    </div>
  );
};
